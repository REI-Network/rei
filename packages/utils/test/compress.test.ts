import { expect } from 'chai';
import { hexStringToBuffer, compressBytes, decompressBytes } from '../src';

describe('Compress', () => {
  const data1 = hexStringToBuffer('0x0000000000000000000000000000000000000000000000000de0b6b3a7640000');
  const data2 = hexStringToBuffer('0x6dccc565ee3296e533e4be98733e284a45da7ca72883935f418c11f284354a3c');

  it('length should be shorter than the original data', () => {
    const compressed = compressBytes(data1);
    expect(compressed.length, 'compressed should be shorter').be.lt(data1.length);
  });

  it('length should be equal to the original data', () => {
    const compressed = compressBytes(data2);
    expect(compressed.equals(data2), 'should be equal').be.true;
  });

  it('should decompress correctly', () => {
    const compressed = compressBytes(data1);
    const decompressed = decompressBytes(compressed, data1.length);
    expect(decompressed.equals(data1), 'the decompressed data should be equal').be.true;
  });
});
