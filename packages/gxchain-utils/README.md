# @gxchain2/utils
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/utils)](https://www.npmjs.org/package/@gxchain2/utils)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/utils)](https://packagephobia.now.sh/result?p=@gxchain2/utils)
![License](https://img.shields.io/npm/l/@gxchain2/utils)


Utils includes the commonly used classes in the program:
- `abort` Aborter is a interrupt class used to terminate the module.
- `channel` Used to cache data, arranged in order.
- `compress` Functions used to compress and decompress data.
- `functionalmap` The key of map could be an object.

## INSTALL

```sh
npm install @gxchain2/utils
```

## USAGE

```ts
const aborter = new Aborter();
const channel = new HChannel<BlockHeader>({
    compare: (a, b) => a.number.lt(b.number);
});
const dataAfter = compressBytes(data);
const dataBefore = decompressBytes(dataAfter,data.length);
const bufferToburffer = createBufferFunctionalMap<Buffer>()
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
