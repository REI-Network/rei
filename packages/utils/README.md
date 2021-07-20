# @gxchain2/utils

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/utils)](https://www.npmjs.org/package/@gxchain2/utils)
![License](https://img.shields.io/npm/l/@gxchain2/utils)

Utils include the following classes:

- `Channel`: Contains three implements
  - `Channel`: An asynchronous queue, order by the order in which the elements are pushed
  - `HChannel`: An asynchronous queue, order by customizable heap
  - `PChannel`: An asynchronous queue, order by element index(grow from 0) and index must be continuous
- `Compress`: Provide some functions for compressing and decompressing data
- `FunctionalMap` and `FunctionalSet`: Key customizable map and set

## INSTALL

```sh
npm install @gxchain2/utils
```

## USAGE

```ts
const channel = new Channel<string>();
channel.push('123');
channel.push('456');
setTimeout(() => {
  channel.push('789');
}, 1000);
setTimeout(() => {
  channel.push('101112');
}, 2000);
setTimeout(() => {
  channel.abort();
}, 3000);

(async () => {
  for await (const data of channel.generator()) {
    console.log('data:', data);
  }
  console.log('channel end');
})();
```

```ts
const bufferMap = new FunctionalMap<Buffer, string>((a: Buffer, b: Buffer) => a.compare(b));
bufferMap.set(Buffer.from('aaaaaa', 'hex'), 'aaaaaa');
console.log(bufferMap.get(Buffer.from('aaaaaa', 'hex')) === 'aaaaaa'); // true
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
