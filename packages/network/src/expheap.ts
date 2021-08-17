import Heap from 'qheap';

export type ExpItem = {
  peerId: string;
  exp: number;
};

/**
 * A heap used to manage the expire timestamp of remote peer
 */
export class ExpHeap {
  private heap: Heap;
  constructor() {
    this.heap = new Heap({
      comparBefore: (a: ExpItem, b: ExpItem) => a.exp < b.exp
    });
  }

  /**
   * Return the expire timestamp of the next element
   */
  nextExpiry(): undefined | number {
    return this.heap.peek()?.exp;
  }

  /**
   * Add peer to heap
   * @param peerId - Target peer
   * @param exp - Expire timestamp
   */
  add(peerId: string, exp: number) {
    this.heap.insert({ peerId, exp });
  }

  /**
   * Find whether the target peer exists
   * @param peerId - Target peer
   * @returns Whether exists
   */
  contains(peerId: string) {
    for (let i = 1; i <= this.heap.length; i++) {
      const item: undefined | ExpItem = this.heap._list[i];
      if (item && item.peerId === peerId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove elements by timestamp
   * @param now - Timestamp
   */
  expire(now: number) {
    let item: undefined | ExpItem;
    while ((item = this.heap.peek()) && item !== undefined && item.exp <= now) {
      this.heap.remove();
    }
  }
}
