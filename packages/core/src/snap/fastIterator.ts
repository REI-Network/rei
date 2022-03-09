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

export type FastSnapAsyncGenerator<T> = AsyncGenerator<FastSnapReturnType<T>, FastSnapReturnType<T> | void>;

export class FastSnapIterator<T> {
  readonly root: Buffer;

  private iterators: WeightedIterator<T | null>[] = [];
  private initiated: boolean = false;
  private asyncGenerator?: FastSnapAsyncGenerator<T>;

  constructor(snap: ISnapshot, genSnapIterator: (snap: ISnapshot) => { iter: SnapIterator<T | null>; stop: boolean }) {
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
  async init() {
    const positioned = new FunctionalBufferMap<number>();

    for (let i = 0; i < this.iterators.length; i++) {
      let iter = this.iterators[i];
      while (true) {
        if (!(await iter.next())) {
          const last = this.iterators[this.iterators.length - 1];
          this.iterators[i] = last;
          this.iterators.pop();

          i--;
          break;
        }

        const hash = iter.curr!;
        const other = positioned.get(hash);
        if (other === undefined) {
          positioned.set(hash, i);
          break;
        } else {
          if (this.iterators[other].priority < iter.priority) {
            continue;
          } else {
            iter = this.iterators[other];
            const temp = this.iterators[i];
            this.iterators[i] = this.iterators[other];
            this.iterators[other] = temp;
            continue;
          }
        }
      }
    }

    this.iterators.sort((a, b) => {
      let ret = a.curr!.compare(b.curr!);
      if (ret === 0) {
        ret = a.priority - b.priority;
      }
      return ret;
    });
  }

  /**
   * Move the iterator at the specified index to the next target
   * @param index - Specified index
   * @returns Whether there are any remaining elements
   */
  async next(index: number) {
    const iter = this.iterators[index];
    if (!(await iter.next())) {
      this.iterators.splice(index, 1);
      return this.iterators.length > 0;
    }

    if (index === this.iterators.length - 1) {
      return true;
    }

    const curr = this.iterators[index];
    const next = this.iterators[index + 1];
    const currHash = curr.curr!;
    const nextHash = next.curr!;
    const diff = currHash.compare(nextHash);
    if (diff < 0) {
      return true;
    } else if (diff === 0 && curr.priority < next.priority) {
      await this.next(index + 1);
      return true;
    }

    let clash = -1;
    let _index = this.iterators.findIndex((_iter, n) => {
      if (n < index) {
        return false;
      }

      if (n === this.iterators.length - 1) {
        return true;
      }

      const _nextHash = this.iterators[n + 1].curr!;
      const _diff = currHash.compare(_nextHash);
      if (_diff < 0) {
        return true;
      } else if (_diff > 0) {
        return false;
      }

      clash = n + 1;

      return curr.priority < this.iterators[n + 1].priority;
    });
    if (_index === -1) {
      _index = this.iterators.length - 1;
    }
    this.iterators = [...this.iterators.slice(0, index), ...this.iterators.slice(index + 1, _index + 1), this.iterators[index], ...this.iterators.slice(_index + 1)];

    if (clash !== -1) {
      await this.next(clash);
    }
    return true;
  }

  /**
   * Generate an async generator to iterate all elements
   */
  [Symbol.asyncIterator](): FastSnapAsyncGenerator<T> {
    if (this.asyncGenerator) {
      throw new Error('repeat iterate');
    }

    return (this.asyncGenerator = async function* (this: FastSnapIterator<T>) {
      try {
        if (!this.initiated) {
          this.initiated = true;
          const hash = this.iterators[0].curr!;
          const value = this.iterators[0].getCurrValue!();
          if (value !== null) {
            yield { hash, value };
          }
        }

        while (await this.next(0)) {
          const hash = this.iterators[0].curr!;
          const value = this.iterators[0].getCurrValue!();
          if (value !== null) {
            yield { hash, value };
          }
        }
      } finally {
        this.asyncGenerator = undefined;
      }
    }.call(this));
  }

  /**
   * Abort iterator
   */
  async abort() {
    if (this.asyncGenerator) {
      await this.asyncGenerator.return();
      this.asyncGenerator = undefined;
    }

    await Promise.all(this.iterators.map(({ iter }) => iter.return()));
    this.iterators = [];
  }
}
