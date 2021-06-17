# @gxchain2/utils
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/utils)](https://www.npmjs.org/package/@gxchain2/utils)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/utils)](https://packagephobia.now.sh/result?p=@gxchain2/utils)
![License](https://img.shields.io/npm/l/@gxchain2/utils)


Utils includes the commonly used classes in the program:
- `Aborter` Aborter is a interrupt class used to terminate the module.
  
- channel: Used to cache data, arranged in order, including `Channel`, `HChannel`, `PChannel`
  
- `compress` Functions used to compress and decompress data.
  
- `functionalmap` The key of map could be an object.

## INSTALL

```sh
npm install @gxchain2/utils
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
