import createRBTree from 'functional-red-black-tree';
import { BN } from 'ethereumjs-util';

const bufferCompare = (a: Buffer, b: Buffer) => a.compare(b);

const bnCompare = (a: BN, b: BN) => a.cmp(b);

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

/**
 * The extended map structure is used to store data whose keys are objects
 */
export class FunctionalMap<K, V> implements Map<K, V> {
  private readonly compare?: (a: K, b: K) => number;
  private tree;

  constructor(compare?: (a: K, b: K) => number) {
    this.compare = compare;
    this.tree = createRBTree(this.compare);
  }

  /**
   * In the order of insertion, callBackFn is called once for
   * each key-value pair in the Map object
   * @param callbackfn Callback function
   * @param thisArg Pointer redirection for callback functions
   */
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    for (const [key, value] of this) {
      thisArg ? callbackfn.call(thisArg, value, key, this) : callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /**
   * Return a new Iterator object, which contains the [key, value]
   * array of each element in the Map object in the order of insertion.
   * @returns A new IterableIterator<[K, V]> object
   */
  entries(): IterableIterator<[K, V]> {
    return new FunctionalMapKeyValueIterator<K, V>(this.tree.begin);
  }

  /**
   * Return a new Iterator object, which contains the key of each
   * element in the Map object in the order of insertion
   * @returns A new IterableIterator<K> object
   */
  keys(): IterableIterator<K> {
    return new FunctionalMapKeyIterator<K>(this.tree.begin);
  }

  /**
   * Return a new Iterator object, which contains the value of each
   * element in the Map object in the order of insertion
   * @returns A new IterableIterator<V> object
   */
  values(): IterableIterator<V> {
    return new FunctionalMapValueIterator<V>(this.tree.begin);
  }

  get [Symbol.toStringTag](): string {
    return 'FunctionalMap';
  }

  /**
   * Clear the map and point the root node of the tree to null
   */
  clear(): void {
    this.tree.root = null;
  }

  /**
   * Determine whether the key is in the map
   * @param key Key name
   * @returns `true` if map has the key
   */
  has(key: K): boolean {
    return !!this.tree.get(key);
  }

  /**
   * Get the number of elements in the map
   */
  get size(): number {
    return this.tree.length;
  }

  /**
   * Add key-value pairs into the map
   * @param key
   * @param value
   * @returns The FunctionalMap
   */
  set(key: K, value: V): this {
    this.tree = this.tree.remove(key);
    this.tree = this.tree.insert(key, value);
    return this;
  }

  /**
   * Get the value in the map based on the key
   * @param key
   * @returns The value
   */
  get(key: K): V | undefined {
    return this.tree.get(key);
  }

  /**
   * Delete the value in the map based on the key
   * @param key
   * @returns `true` if successfully deleted
   */
  delete(key: K): boolean {
    const newTree = this.tree.remove(key);
    const result = newTree.length !== this.tree.length;
    if (result) {
      this.tree = newTree;
    }
    return result;
  }
}

/**
 * Create a functionalMap which uses Buffer type as the key
 * @returns The functionalMap object
 */
export function createBufferFunctionalMap<T>() {
  return new FunctionalMap<Buffer, T>(bufferCompare);
}

/**
 * Create a functionalMap which uses BN type as the key
 * @returns The functionalMap object
 */
export function createBNFunctionalMap<T>() {
  return new FunctionalMap<BN, T>(bnCompare);
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

/**
 * The extended set structure is used to store data whose keys are objects
 */
export class FunctionalSet<T> implements Set<T> {
  private readonly compare?: (a: T, b: T) => number;
  private tree;

  constructor(compare?: (a: T, b: T) => number) {
    this.compare = compare;
    this.tree = createRBTree(this.compare);
  }

  /**
   * Clear the set and point the root node of the tree to null
   */
  clear(): void {
    this.tree.root = null;
  }

  /**
   * Delete the value in the set
   * @param value
   * @returns `true` if successfully deleted
   */
  delete(value: T): boolean {
    const newTree = this.tree.remove(value);
    const result = newTree.length !== this.tree.length;
    if (result) {
      this.tree = newTree;
    }
    return result;
  }

  /**
   * Determine whether the value is in the set
   * @param value Key name
   * @returns `true` if map has the key
   */
  has(value: T): boolean {
    return !!this.tree.get(value);
  }

  /**
   * Get the number of elements in the set
   */
  get size(): number {
    return this.tree.length;
  }

  /**
   * Add value into the set
   * @param value
   * @returns The functional set
   */
  add(value: T): this {
    this.tree = this.tree.remove(value);
    this.tree = this.tree.insert(value, true);
    return this;
  }

  /**
   * In the order of insertion, callBackFn is called once for
   * each value in the Set object
   * @param callbackfn Callback function
   * @param thisArg Pointer redirection for callback functions
   */
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
    for (const value of this) {
      thisArg ? callbackfn.call(thisArg, value, value, this) : callbackfn(value, value, this);
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values();
  }

  /**
   * Returns a new iterator object that contains the [value, value]
   * array of the values of all the elements in the Set object in the
   * order of insertion.
   * In order to keep this method similar to the Map object, the key
   * and value of each value are equal.
   * @returns A new IterableIterator<[T, T]> object
   */
  entries(): IterableIterator<[T, T]> {
    return new FunctionalSetKeyValueIterator<T>(this.tree.begin);
  }

  /**
   * Same as the values() method, it returns a new iterator object that
   * contains the values of all the elements in the Set object in the
   * order of insertion.
   * @returns A new IterableIterator<T>
   */
  keys(): IterableIterator<T> {
    return this.values();
  }

  /**
   * Returns a new iterator object that yields the values for each
   * element in the Set object in insertion order.
   * @returns A new IterableIterator<T>
   */
  values(): IterableIterator<T> {
    return new FunctionalSetValueIterator<T>(this.tree.begin);
  }

  get [Symbol.toStringTag](): string {
    return 'FunctionalSet';
  }
}

/**
 * Create a functionalSet which uses Buffer type
 * @returns The functionalSet object
 */
export function createBufferFunctionalSet() {
  return new FunctionalSet<Buffer>(bufferCompare);
}

/**
 * Create a functionalSet which uses BN type
 * @returns The functionalSet object
 */
export function createBNFunctionalSet() {
  return new FunctionalSet<BN>(bnCompare);
}
