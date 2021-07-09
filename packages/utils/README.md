# @gxchain2/utils
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/utils)](https://www.npmjs.org/package/@gxchain2/utils)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/utils)](https://packagephobia.now.sh/result?p=@gxchain2/utils)
![License](https://img.shields.io/npm/l/@gxchain2/utils)

<font size=3>
Utils includes the commonly used classes in the program:
- `Aborter` Aborter is a interrupt class used to terminate the module.
  
- channel: Used to cache data, arranged in order, including `Channel`, `HChannel`, `PChannel`
  
- `compress` Functions used to compress and decompress data.
  
- `functionalmap` The key of map could be an object.
</font>


## INSTALL

```sh
npm install @gxchain2/utils
```
## STRUCTURE
- `Aborter`
```ts
/**
 * This class is used to interrupt operations and record interrupt information.
 */
export declare class Aborter {
    private _reason;
    private _abort;
    private _waiting;
    /**
     * Return abort information.
     */
    get reason(): any;
    /**
     * Return the aborter state, whether aborted or not.
     */
    get isAborted(): boolean;
    constructor();
    /**
     * This template function receives a Promise and races with the aborted
     * Promise in the class to ensure the safety of the program.
     * @param p Given Promise to be raced.
     * @param throwAbortError Whether to throw an interrupt error
     * @returns
     */
    abortablePromise<T>(p: Promise<T>): Promise<T | undefined>;
    abortablePromise<T>(p: Promise<T>, throwAbortError: false): Promise<T | undefined>;
    abortablePromise<T>(p: Promise<T>, throwAbortError: true): Promise<T>;
    abortablePromise<T>(p: Promise<T>, throwAbortError: boolean): Promise<T | undefined>;
    /**
     * Create a waiting Promise and push it and it's resolve, reject
     * into the _waiting set
     * @returns
     */
    private createWaitingPromise;
    /**
     * This method abort the class, set the _abort state, the abort reason
     * clear the _waiting set.
     * @param reason Reason for interruption
     */
    abort(reason?: string | AbortError): Promise<void>;
    /**
     * Reset the options: _reason and _abort
     */
    reset(): void;
}
```
- `Channel`
```ts
/**
 * Channel class, the storage structure is an array
 */
export declare class Channel<T = any> {
    private aborted;
    private _array;
    private max?;
    private drop?;
    private resolve?;
    private reject?;
    /**
     * Get the data in the array
     */
    get array(): T[];
    constructor(options?: ChannelOption<T>);
    /**
     * Push data into array
     * @param data Data to be processed
     * @returns `true` if successfully pushed
     */
    push(data: T): boolean;
    /**
     * Next is an iterative function
     * @returns The first element in the array if the array.length is
     * greater than zero, else new a Promise
     */
    next(): Promise<T>;
    /**
     * Issue an interrupt command to clean up the channel
     */
    abort(): void;
    /**
     * Reset aborted status
     */
    reset(): void;
    /**
     * Clear the channel and drop the data in array
     */
    clear(): void;
    /**
     * Iterator function, used to get data in the channel
     */
    generator(): AsyncGenerator<T, void, unknown>;
}
export interface HChannelOption<T> extends ChannelOption<T> {
    compare?: (a: T, b: T) => boolean;
}
/**
 * Channel class, the storage structure is a heap
 */
export declare class HChannel<T = any> {
    private aborted;
    private _heap;
    private max?;
    private drop?;
    private resolve?;
    private reject?;
    /**
     * Get the data in the heap
     */
    get heap(): any;
    constructor(options?: HChannelOption<T>);
    /**
     * Insert data into heap
     * @param data Data to be processed
     * @returns `true` if successfully pushed
     */
    push(data: T): boolean;
    /**
     * Next is an iterative function
     * @returns The first element in the heap if the heap.length is
     * greater than zero, else new a Promise
     */
    next(): Promise<T>;
    /**
     * Issue an interrupt command to clean up the channel
     */
    abort(): void;
    /**
     * Reset aborted status
     */
    reset(): void;
    /**
     * Clear the channel and drop the data in heap
     */
    clear(): void;
    /**
     * Iterator function, used to get data in the channel
     */
    generator(): AsyncGenerator<T, void, unknown>;
}
/**
 * Channel class, the storage structures are array and heap
 */
export declare class PChannel<U = any, T extends {
    data: U;
    index: number;
} = {
    data: any;
    index: number;
}> {
    private processed;
    private aborted;
    private _array;
    private _heap;
    private max?;
    private drop?;
    private resolve?;
    private reject?;
    /**
     * Get the data in the heap
     */
    get heap(): any;
    /**
     * Get the data in the array
     */
    get array(): T[];
    constructor(options?: ChannelOption<T>);
    /**
     * Push the element into the heap and add it to the array after sorting
     * @param data Data to be processed
     * @returns `true` if successfully pushed
     */
    push(data: T): boolean;
    next(): Promise<T>;
    abort(): void;
    reset(): void;
    /**
     * Clear the channel and drop the data in heap and array
     */
    clear(): void;
    generator(): AsyncGenerator<T, void, unknown>;
    /**
     * Get the processed elements in the heap
     * @returns The elements array
     */
    private readies;
}
```
- `functionalmap`
```ts
**
 * The extended map structure is used to store data whose keys are objects
 */
export declare class FunctionalMap<K, V> implements Map<K, V> {
    private readonly compare?;
    private tree;
    constructor(compare?: (a: K, b: K) => number);
    /**
     * In the order of insertion, callBackFn is called once for
     * each key-value pair in the Map object
     * @param callbackfn Callback function
     * @param thisArg Pointer redirection for callback functions
     */
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    /**
     * Return a new Iterator object, which contains the [key, value]
     * array of each element in the Map object in the order of insertion.
     * @returns A new IterableIterator<[K, V]> object
     */
    entries(): IterableIterator<[K, V]>;
    /**
     * Return a new Iterator object, which contains the key of each
     * element in the Map object in the order of insertion
     * @returns A new IterableIterator<K> object
     */
    keys(): IterableIterator<K>;
    /**
     * Return a new Iterator object, which contains the value of each
     * element in the Map object in the order of insertion
     * @returns A new IterableIterator<V> object
     */
    values(): IterableIterator<V>;
    get [Symbol.toStringTag](): string;
    /**
     * Clear the map and point the root node of the tree to null
     */
    clear(): void;
    /**
     * Determine whether the key is in the map
     * @param key Key name
     * @returns `true` if map has the key
     */
    has(key: K): boolean;
    /**
     * Get the number of elements in the map
     */
    get size(): number;
    /**
     * Add key-value pairs into the map
     * @param key
     * @param value
     * @returns The FunctionalMap
     */
    set(key: K, value: V): this;
    /**
     * Get the value in the map based on the key
     * @param key
     * @returns The value
     */
    get(key: K): V | undefined;
    /**
     * Delete the value in the map based on the key
     * @param key
     * @returns `true` if successfully deleted
     */
    delete(key: K): boolean;
}
```
## USAGE

```ts
const aborter = new Aborter();
aborter.reset();                 // reset the aborter
console.log(aborter.reason);     
console.log(aborter.isAborted)   // get the aborter's state
aborter.abort();                 // abort the aborter

const channel = new HChannel<BlockHeader>({
    compare: (a, b) => a.number.lt(b.number);
});
channel.push(data as BlockHeader) // push data into channel
channel.clear()                   // clear the channel

const dataAfter = compressBytes(data); //compress the data 
const dataBefore = decompressBytes(dataAfter,data.length); //decompress the data

const bufferTobuffer = createBufferFunctionalMap<Buffer>()
bufferTobuffer.keys()   // get keys from the map
bufferTobuffer.values() // get values from the map
bufferTobuffer.set(buffer, buffer); //set key and value into map
bufferTobuffer.get(buffer) // get value from map
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
