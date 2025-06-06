import createRBTree from 'functional-red-black-tree';
import { BN, Address } from 'ethereumjs-util';
import { FunctionalMapIterator } from './functionalMap';

class FunctionalSetValueIterator<T> extends FunctionalMapIterator<T> {
  protected value(): T | undefined {
    return this.rbtreeIt.key;
  }
}

class FunctionalSetKeyValueIterator<T> extends FunctionalMapIterator<[T, T]> {
  protected value(): [T, T] | undefined {
    return !this.rbtreeIt.key || !this.rbtreeIt.value
      ? undefined
      : [this.rbtreeIt.key, this.rbtreeIt.key];
  }
}

/**
 * Key customizable map, implements `Set` interface
 */
export class FunctionalSet<T> implements Set<T> {
  private readonly compare?: (a: T, b: T) => number;
  private tree;

  constructor(compare?: (a: T, b: T) => number) {
    this.compare = compare;
    this.tree = createRBTree(this.compare);
  }

  clear(): void {
    this.tree.root = null;
  }

  delete(value: T): boolean {
    const newTree = this.tree.remove(value);
    const result = newTree.length !== this.tree.length;
    if (result) {
      this.tree = newTree;
    }
    return result;
  }

  has(value: T): boolean {
    return !!this.tree.get(value);
  }

  get size(): number {
    return this.tree.length;
  }

  add(value: T): this {
    this.tree = this.tree.remove(value);
    this.tree = this.tree.insert(value, true);
    return this;
  }

  forEach(
    callbackfn: (value: T, value2: T, set: Set<T>) => void,
    thisArg?: any
  ): void {
    for (const value of this) {
      thisArg
        ? callbackfn.call(thisArg, value, value, this)
        : callbackfn(value, value, this);
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values();
  }

  entries(): IterableIterator<[T, T]> {
    return new FunctionalSetKeyValueIterator<T>(this.tree.begin);
  }

  keys(): IterableIterator<T> {
    return this.values();
  }

  values(): IterableIterator<T> {
    return new FunctionalSetValueIterator<T>(this.tree.begin);
  }

  get [Symbol.toStringTag](): string {
    return 'FunctionalSet';
  }
}

export class FunctionalBufferSet extends FunctionalSet<Buffer> {
  constructor() {
    super((a, b) => a.compare(b));
  }
}

export class FunctionalBNSet extends FunctionalSet<BN> {
  constructor() {
    super((a, b) => a.cmp(b));
  }
}

export class FunctionalAddressSet extends FunctionalSet<Address> {
  constructor() {
    super((a, b) => a.buf.compare(b.buf));
  }
}
