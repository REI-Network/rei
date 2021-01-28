import createRBTree from 'functional-red-black-tree';

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
