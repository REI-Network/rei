import createRBTree from 'functional-red-black-tree';
import { BN } from 'ethereumjs-util';

const bufferCompare = (a: Buffer, b: Buffer) => {
  if (a.length < b.length) {
    return -1;
  }
  if (a.length > b.length) {
    return 1;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) {
      return -1;
    }
    if (a[i] > b[i]) {
      return 1;
    }
  }
  return 0;
};

const bnCompare = (a: BN, b: BN) => {
  if (a.lt(b)) {
    return -1;
  }
  if (a.gt(b)) {
    return 1;
  }
  return 0;
};

const stringCompare = (a: string, b: string) => {
  if (a.length < b.length) {
    return -1;
  }
  if (a.length > b.length) {
    return 1;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) {
      return -1;
    }
    if (a[i] > b[i]) {
      return 1;
    }
  }
  return 0;
};

export class FunctionalMapIterator<T> implements IterableIterator<T> {
  protected readonly rbtreeIt;
  private stop = false;

  constructor(rbtreeIt) {
    this.rbtreeIt = rbtreeIt;
  }

  protected value(): T | undefined {
    throw new Error('Unimplemented');
  }

  next() {
    if (this.stop) {
      return {
        done: true,
        value: undefined as any
      };
    } else if (!this.rbtreeIt.hasNext) {
      this.stop = true;
      const value = this.value();
      return value
        ? {
            done: false,
            value
          }
        : {
            done: true,
            value: undefined as any
          };
    } else {
      const value = this.value();
      this.rbtreeIt.next();
      return {
        done: false,
        value
      };
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this;
  }
}

class FunctionalMapKeyIterator<K> extends FunctionalMapIterator<K> {
  protected value(): K | undefined {
    return this.rbtreeIt.key;
  }
}

class FunctionalMapValueIterator<V> extends FunctionalMapIterator<V> {
  protected value(): V | undefined {
    return this.rbtreeIt.value;
  }
}

class FunctionalMapKeyValueIterator<K, V> extends FunctionalMapIterator<[K, V]> {
  protected value(): [K, V] | undefined {
    return !this.rbtreeIt.key || !this.rbtreeIt.value ? undefined : [this.rbtreeIt.key, this.rbtreeIt.value];
  }
}

export class FunctionalMap<K, V> implements Map<K, V> {
  private readonly compare?: (a: K, b: K) => number;
  private tree;

  constructor(compare?: (a: K, b: K) => number) {
    this.compare = compare;
    this.tree = createRBTree(this.compare);
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    for (const [key, value] of this) {
      thisArg ? callbackfn.call(thisArg, value, key, this) : callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  entries(): IterableIterator<[K, V]> {
    return new FunctionalMapKeyValueIterator<K, V>(this.tree.begin);
  }

  keys(): IterableIterator<K> {
    return new FunctionalMapKeyIterator<K>(this.tree.begin);
  }

  values(): IterableIterator<V> {
    return new FunctionalMapValueIterator<V>(this.tree.begin);
  }

  get [Symbol.toStringTag](): string {
    return 'FunctionalMap';
  }

  clear(): void {
    this.tree.root = null;
  }

  has(key: K): boolean {
    return !!this.tree.get(key);
  }

  get size(): number {
    return this.tree.length;
  }

  set(key: K, value: V): this {
    this.tree = this.tree.remove(key);
    this.tree = this.tree.insert(key, value);
    return this;
  }

  get(key: K): V | undefined {
    return this.tree.get(key);
  }

  delete(key: K): boolean {
    const newTree = this.tree.remove(key);
    const result = newTree.length !== this.tree.length;
    if (result) {
      this.tree = newTree;
    }
    return result;
  }
}

export function createBufferFunctionalMap<T>() {
  return new FunctionalMap<Buffer, T>(bufferCompare);
}

export function createBNFunctionalMap<T>() {
  return new FunctionalMap<BN, T>(bnCompare);
}

export function createStringFunctionalMap<T>() {
  return new FunctionalMap<string, T>(stringCompare);
}

class FunctionalSetValueIterator<T> extends FunctionalMapIterator<T> {
  protected value(): T | undefined {
    return this.rbtreeIt.key;
  }
}

class FunctionalSetKeyValueIterator<T> extends FunctionalMapIterator<[T, T]> {
  protected value(): [T, T] | undefined {
    return !this.rbtreeIt.key || !this.rbtreeIt.value ? undefined : [this.rbtreeIt.key, this.rbtreeIt.value];
  }
}

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

  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
    for (const value of this) {
      thisArg ? callbackfn.call(thisArg, value, value, this) : callbackfn(value, value, this);
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

export function createBufferFunctionalSet() {
  return new FunctionalSet<Buffer>(bufferCompare);
}

export function createBNFunctionalSet() {
  return new FunctionalSet<BN>(bnCompare);
}
