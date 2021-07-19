import { expect } from 'chai';
import { Channel, HChannel, PChannel } from '../src';
const testdata = ['0x02abe0a061c42bd49192e2174be7de7de842a00c3a415f7b01c072d443d6b305', '0x39ad914753bdc0f29680d43960c6aa92ab2896cd11269cb35e3f89e27b87168b', '0x6dccc565e03296e533e4be08733e284a45d07c072883935f418c11f284354a3c', '0xa2d39d66f541c087e6736636b479d38f86dc4cab85bf35d9356495125b893ffe', '0xc275b0192c987dc235303aed7535a1c268fa786421bbe51643ffc671fd3fc5d7', '0xcc1ff1f83e4590f86b198fb4c369b88bcae4f32bfeb27514b930d23b92b5ce0b'];

describe('Channel', () => {
  const stringChannel = new Channel<string>();
  before(() => {
    testdata.map((hash) => {
      stringChannel.push(hash);
    });
  });

  it('should get array', () => {
    stringChannel.array.map((element, i) => {
      expect(element, 'array member should be euqal').be.equal(testdata[i]);
    });
  });

  it('should get generator', async () => {
    let i = 0;
    for await (const element of stringChannel.generator()) {
      expect(element, 'array member should be euqal').be.equal(testdata[i++]);
      if (stringChannel.array.length == 0) {
        break;
      }
    }
  });

  it('should clear', () => {
    testdata.map((hash) => {
      stringChannel.push(hash);
    });
    stringChannel.clear();
    expect(stringChannel.array.length, 'Channel should be empty').be.equal(0);
  });
});

describe('HChannel', () => {
  const stringHChannel = new HChannel<string>();
  before(() => {
    testdata.map((hash) => {
      stringHChannel.push(hash);
    });
  });

  it('should get heap', () => {
    stringHChannel.heap._list.map((element, i) => {
      expect(element, 'heap member should be euqal').be.equal(testdata[i - 1]);
    });
  });

  it('should get generator', async () => {
    let i = 0;
    for await (const element of stringHChannel.generator()) {
      expect(element, 'heap member should be euqal').be.equal(testdata[i++]);
      if (stringHChannel.heap.length == 0) {
        break;
      }
    }
  });

  it('should clear', () => {
    testdata.map((hash) => {
      stringHChannel.push(hash);
    });
    stringHChannel.clear();
    expect(stringHChannel.heap.length, 'HChannel should be empty').be.equal(0);
  });
});

describe('PChannel', () => {
  const stringPChannel = new PChannel<string>();
  before(() => {
    testdata.map((hash) => {
      // stringPChannel.push();
    });
  });
});
