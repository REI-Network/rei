import { FunctionalBufferMap } from '@rei-network/utils';
import { ISnapshot, SnapIterator } from './types';

class WeightedIterator<T> {
  readonly iter: SnapIterator<T>;
  readonly priority: number;

  curr?: Buffer;
  getCurrValue?: () => T;

  constructor(iter: SnapIterator<T>, priority: number) {
    this.iter = iter;
    this.priority = priority;
  }

  async next() {
    const { value } = await this.iter.next();
    if (value) {
      this.curr = value.hash;
      this.getCurrValue = value.getValue;
      return true;
    } else {
      this.curr = undefined;
      this.getCurrValue = undefined;
      return false;
    }
  }
}

export type FastSnapReturnType<T> = { hash: Buffer; value: T };

export type FastSnapAsyncGenerator<T> = AsyncGenerator<
  FastSnapReturnType<T>,
  FastSnapReturnType<T> | void
>;

export class FastSnapIterator<T> {
  readonly root: Buffer;

  private iterators: WeightedIterator<T | null>[] = [];
  private initiated = false;

  constructor(
    snap: ISnapshot,
    genSnapIterator: (snap: ISnapshot) => {
      iter: SnapIterator<T | null>;
      stop: boolean;
    },
    private onAbort?: () => void
  ) {
    this.root = snap.root;
    let _snap: undefined | ISnapshot = snap;
    for (let depth = 0; _snap !== undefined; depth++) {
      const { iter, stop } = genSnapIterator(_snap);
      this.iterators.push(new WeightedIterator<T | null>(iter, depth));
      if (stop) {
        break;
      }
      _snap = _snap.parent;
    }
  }

  /**
   * Initialize fast iterator
   */
  private async init() {
    // track which account hashes are iterators positioned on
    const positioned = new FunctionalBufferMap<number>();

    // make sure that each iterator has at least one element to be processed
    for (let i = 0; i < this.iterators.length; i++) {
      let iter = this.iterators[i];
      while (true) {
        if (!(await iter.next())) {
          // if an iterator has no next element, remove it from the array
          const last = this.iterators[this.iterators.length - 1];
          // swap with the last element, the order is not concerned here
          this.iterators[i] = last;
          this.iterators.pop();

          i--;
          break;
        }

        const hash = iter.curr!;
        const other = positioned.get(hash);
        if (other === undefined) {
          // if the hash does not appear, add it to `positioned` and continue
          positioned.set(hash, i);
          break;
        } else {
          if (this.iterators[other].priority < iter.priority) {
            // if the previous hash has a higher priority than this, continue processing the next hash of this iterator
            continue;
          } else {
            // otherwise, swap the positions of the two iterators, process the next hash of the previous iterator
            iter = this.iterators[other];
            const temp = this.iterators[i];
            this.iterators[i] = this.iterators[other];
            this.iterators[other] = temp;
            continue;
          }
        }
      }
    }

    // sort by hash and priority
    this.iterators.sort((a, b) => {
      let ret: number = a.curr!.compare(b.curr!);
      if (ret === 0) {
        ret = a.priority - b.priority;
      }
      return ret;
    });
  }

  /**
   * Move the iterator at the specified index to the next target,
   * and sort all iterators by hash and priority
   * @param index - Specified index
   * @returns Whether there are any remaining elements
   */
  async next(index: number) {
    if (index > this.iterators.length - 1) {
      return false;
    }

    const iter = this.iterators[index];
    if (!(await iter.next())) {
      // if this iterator has no next element, move it out of the array
      this.iterators.splice(index, 1);
      // the remaining elements are already sorted and do not need to be sorted again
      return this.iterators.length > 0;
    }

    if (index === this.iterators.length - 1) {
      // there is only one iterator left, no need to sort again
      return true;
    }

    const curr = this.iterators[index];
    const next = this.iterators[index + 1];
    const currHash = curr.curr!;
    const nextHash = next.curr!;
    const diff = currHash.compare(nextHash);
    if (diff < 0) {
      /**
       * even if the iterator is changed,
       * all elements in the array remain in order
       * and do not need to be reordered
       */
      return true;
    } else if (diff === 0 && curr.priority < next.priority) {
      /**
       * although all elements in the array remain in order,
       * it is still necessary to determine whether there are valid elements in the next iterator
       */
      await this.next(index + 1);
      return true;
    }

    /**
     * at this point, the remaining elements in the array are still in order,
     * just need to find a correct position for the target element
     *
     * example: [5, 1, 2, 3, 4, 6, 7], index = 0
     * in this case, we need to move the target element `5` to the front of `6`
     */
    let clash = -1; // clash is used to record the next iterator that needs to be processed
    let _index = this.iterators.findIndex((_iter, n) => {
      if (n < index) {
        // ignore ordered elements
        return false;
      }

      if (n === this.iterators.length - 1) {
        // move the target element after the last element
        return true;
      }

      const _nextHash = this.iterators[n + 1].curr!;
      const _diff = currHash.compare(_nextHash);
      if (_diff < 0) {
        // find the correct position, return
        return true;
      } else if (_diff > 0) {
        // continue to search for the correct position
        return false;
      }

      /**
       * this is a special case, the index of the next iterator is recorded for the following logic,
       * because we also need to check if there are still valid elements in the next iterator
       */
      clash = n + 1;

      return curr.priority < this.iterators[n + 1].priority;
    });

    // move target element to the correct position
    this.iterators = [
      ...this.iterators.slice(0, index),
      ...this.iterators.slice(index + 1, _index + 1),
      this.iterators[index],
      ...this.iterators.slice(_index + 1)
    ];

    // continue to check the next iterator, if necessary
    if (clash !== -1) {
      await this.next(clash);
    }

    return true;
  }

  /**
   * Generate an async generator to iterate all elements
   */
  async *[Symbol.asyncIterator](): FastSnapAsyncGenerator<T> {
    try {
      await this.init();
      if (this.iterators.length === 0) {
        return;
      }

      if (!this.initiated) {
        this.initiated = true;
        const hash = this.iterators[0].curr!;
        const value = this.iterators[0].getCurrValue!();
        // filter empty buffer
        if (value instanceof Buffer && value.length > 0) {
          yield { hash, value };
        } else if (!(value instanceof Buffer) && value !== null) {
          yield { hash, value };
        }
      }

      while (await this.next(0)) {
        const hash = this.iterators[0].curr!;
        const value = this.iterators[0].getCurrValue!();
        // filter empty buffer
        if (value instanceof Buffer && value.length > 0) {
          yield { hash, value };
        } else if (!(value instanceof Buffer) && value !== null) {
          yield { hash, value };
        }
      }
    } finally {
      await this.abort();
    }
  }

  /**
   * Abort iterator
   */
  async abort() {
    await Promise.all(this.iterators.map(({ iter }) => iter.return()));
    this.iterators = [];
    this.onAbort?.();
  }
}
