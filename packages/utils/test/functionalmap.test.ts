import { expect } from 'chai';
import { hexStringToBuffer, createBufferFunctionalMap, createBufferFunctionalSet } from '../src';

const testdata = ['0xc275b0192c987dc235303aed7535a1c268fa786421bbe51643ffc671fd3fc5d7', '0xcc1ff1f83e4590f86b198fb4c369b88bcae4f32bfeb27514b930d23b92b5ce0b', '0x6dccc565e03296e533e4be08733e284a45d07c072883935f418c11f284354a3c', '0xa2d39d66f541c087e6736636b479d38f86dc4cab85bf35d9356495125b893ffe', '0x02abe0a061c42bd49192e2174be7de7de842a00c3a415f7b01c072d443d6b305', '0x39ad914753bdc0f29680d43960c6aa92ab2896cd11269cb35e3f89e27b87168b'];
const testBuffer = testdata.map((element) => {
  return hexStringToBuffer(element);
});
const testdataSorted = [...testdata].sort();
const testBufferSorted = testdataSorted.map((element) => {
  return hexStringToBuffer(element);
});

describe('FunctionalMap', () => {
  const bufferToStringMap = createBufferFunctionalMap<string>();

  it('should get map size', () => {
    testdata.forEach((blockhash, i) => {
      bufferToStringMap.set(testBuffer[i], blockhash);
    });
    expect(bufferToStringMap.size, 'map size should be equal').be.equal(testBuffer.length);
  });

  it('should has the hash', () => {
    const key = testBuffer[0];
    expect(bufferToStringMap.has(key), 'function result should be true').be.true;
  });

  it('should get value', () => {
    const key = testBuffer[0];
    expect(bufferToStringMap.get(key), 'got value should be equal').be.equal(testdata[0]);
  });

  it('should get values', () => {
    const values = bufferToStringMap.values();
    Array.from(values).forEach((value, i) => {
      expect(value, 'value should be euqal').be.equal(testdataSorted[i]);
    });
  });

  it('should get keys', () => {
    const keys = bufferToStringMap.keys();
    Array.from(keys).forEach((key, i) => {
      expect(key.equals(testBufferSorted[i]), 'key should be euqal').be.true;
    });
  });

  it('should get entries', () => {
    Array.from(bufferToStringMap.entries()).map(([key, value], i) => {
      expect(key.equals(testBufferSorted[i]), 'key should be euqal').be.true;
      expect(value, 'value should be euqal').be.equal(testdataSorted[i]);
    });
  });

  it('should delete element', () => {
    const key = testBuffer[0];
    expect(bufferToStringMap.delete(key), 'function result should be true').be.true;
    expect(bufferToStringMap.has(key), 'function result should be false').be.false;
    expect(bufferToStringMap.size, 'map size should be equal').be.equal(testBuffer.length - 1);
  });

  it('should clear', () => {
    bufferToStringMap.clear();
    expect(bufferToStringMap.size, 'size should be 0').be.equal(0);
  });
});

describe('FunctionalSet', () => {
  const bufferSet = createBufferFunctionalSet();

  it('should get set size', () => {
    testBuffer.map((blockhash) => {
      bufferSet.add(blockhash);
    });
    expect(bufferSet.size, 'set size should be equal').be.equal(testdata.length);
  });

  it('should has the hash', () => {
    const key = testdata[0];
    expect(bufferSet.has(hexStringToBuffer(key)), 'function result should be true').be.true;
  });

  it('should get values', () => {
    const values = bufferSet.values();
    Array.from(values).forEach((value, i) => {
      expect(value.equals(testBufferSorted[i]), 'value should be euqal').be.true;
    });
  });

  it('should get keys', () => {
    const keys = bufferSet.keys();
    Array.from(keys).forEach((key, i) => {
      expect(key.equals(testBufferSorted[i]), 'key should be euqal').be.true;
    });
  });

  it('should get entries', () => {
    Array.from(bufferSet.entries()).map(([key, value], i) => {
      expect(key.equals(testBufferSorted[i]), 'key should be euqal').be.true;
    });
  });

  it('should delete element', () => {
    const key = testBuffer[0];
    expect(bufferSet.delete(key), 'function result should be true').be.true;
    expect(bufferSet.has(key), 'function result should be false').be.false;
    expect(bufferSet.size, 'set size should be equal').be.equal(testdata.length - 1);
  });

  it('should clear', () => {
    bufferSet.clear();
    expect(bufferSet.size, 'size should be 0').be.equal(0);
  });
});
