import Heap from 'qheap';

export type ExpItem = {
  peerId: string;
  exp: number;
};

export class ExpHeap {
  private heap: Heap;
  constructor() {
    this.heap = new Heap({
      comparBefore: (a: ExpItem, b: ExpItem) => a.exp < b.exp
    });
  }

  nextExpiry(): undefined | number {
    return this.heap.peek()?.exp;
  }

  add(peerId: string, exp: number) {
    this.heap.insert({ peerId, exp });
  }

  contains(peerId: string) {
    for (let i = 1; i <= this.heap.length; i++) {
      const item: undefined | ExpItem = this.heap._list[i];
      if (item && item.peerId === peerId) {
        return true;
      }
    }
    return false;
  }

  expire(now: number) {
    let item: undefined | ExpItem;
    while ((item = this.heap.peek()) && item !== undefined && item.exp <= now) {
      this.heap.remove();
    }
  }
}
