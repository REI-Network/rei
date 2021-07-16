import { expect } from 'chai';
import { hexStringToBuffer, compressBytes, decompressBytes } from '../src';

const testdata = ['0x0000000000000000000000000000000000000000000000000de0b6b3a7640000', '0x6dccc565ee3296e533e4be98733e284a45dz7ca72883935f418c11f284354a3c'];

describe('Compress', () => {
  it('should shorter than the original data', () => {
    const compressed = compressBytes(hexStringToBuffer(testdata[0]));
    expect(compressed.length, 'compressed should be shorter').be.lt(hexStringToBuffer(testdata[0]).length);
  });

  it('should equal raw data', () => {
    const compressed = compressBytes(hexStringToBuffer(testdata[1]));
    expect(compressed.equals(hexStringToBuffer(testdata[1])), 'should be equal').be.true;
  });

  it('should decompress correctly', () => {
    const testbuffer = hexStringToBuffer(testdata[0]);
    const compressed = compressBytes(testbuffer);
    const decompressed = decompressBytes(compressed, testbuffer.length);
    expect(decompressed.equals(testbuffer), 'The decompressed data needs to be equal to the original data').be.true;
  });
});
