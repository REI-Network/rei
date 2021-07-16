import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { hexStringToBuffer, compressBytes, decompressBytes } from '../src';

describe('compress', () => {
  let testdata: Buffer;
  let compressed: Buffer;
  let decompressed: Buffer;
  let testdir: string;

  before(() => {
    testdir = path.join(__dirname, './compress-test-data.json');
    const filedata = JSON.parse(fs.readFileSync(testdir).toString());
    testdata = hexStringToBuffer(filedata.testdata);
    compressed = compressBytes(testdata);
    decompressed = decompressBytes(compressed, testdata.length);
    console.log(testdata);
    console.log(compressed.toJSON().data);
  });

  it('should decompress directly', () => {
    expect(decompressed.equals(testdata), 'The decompressed data needs to be equal to the original data').be.true;
  });
});
