import { expect } from 'chai';
import { Channel, HChannel, PChannel } from '../src';

const testdata = [23, 45, 13, 56, 555, 7, 1, 0, 789, 667, 89];
const testdataSorted = [...testdata].sort((a, b) => {
  return a - b;
});
const testdata2 = [90, 886, 3];
const testdata2Sorted = [...testdata2].sort((a, b) => {
  return a - b;
});
const insert = 777;
class HChanneltest {
  data: number;
  constructor(data: number) {
    this.data = data;
  }
}

describe('Channel', () => {
  const numberChannel = new Channel<number>();

  it('should get array', () => {
    testdata.forEach((hash) => {
      numberChannel.push(hash);
    });
    numberChannel.array.forEach((element, i) => {
      expect(element, 'array member should be euqal').be.equal(testdata[i]);
    });
    numberChannel.clear();
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    for (let j = 0; j < testdata2.length; j++) {
      numberChannel.push(testdata2[j]);
    }
    setTimeout(() => {
      numberChannel.abort();
      symbol = true;
    }, 100);
    for await (const element of numberChannel.generator()) {
      expect(element, 'array member should be euqal').be.equal(testdata2[i++]);
    }
    expect(symbol, 'channel be aborted').be.true;
  });

  it('should clear', () => {
    numberChannel.reset();
    testdata.forEach((hash) => {
      numberChannel.push(hash);
    });
    numberChannel.clear();
    expect(numberChannel.array.length, 'channel should be empty').be.equal(0);
  });
});

describe('HChannel', () => {
  const numberHChannel = new HChannel<HChanneltest>({ compare: (a, b) => a.data < b.data });

  it('should get heap', () => {
    testdata.forEach((element) => {
      numberHChannel.push(new HChanneltest(element));
    });
    let i = 0;
    while (numberHChannel.heap.length > 0) {
      expect(numberHChannel.heap.remove().data, 'heap member should be euqal').be.equal(testdataSorted[i++]);
    }
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    for (let j = 0; j < testdata2.length; j++) {
      numberHChannel.push(new HChanneltest(testdata2[j]));
    }
    setTimeout(() => {
      numberHChannel.abort();
      symbol = true;
    }, 100);
    for await (const element of numberHChannel.generator()) {
      expect(element.data, 'heap member should be equal').equal(testdata2Sorted[i++]);
    }
    expect(symbol, 'channel be aborted').be.true;
  });

  it('should clear', () => {
    numberHChannel.reset();
    testdata.forEach((element) => {
      numberHChannel.push(new HChanneltest(element));
    });
    numberHChannel.clear();
    expect(numberHChannel.heap.length, 'the HChannel should be empty').be.equal(0);
  });
});

describe('PChannel', () => {
  const numberPChannel = new PChannel<number>();

  it('should readies', () => {
    testdata.forEach((element, i) => {
      const ele = { data: element, index: i };
      numberPChannel.push(ele);
    });
    testdata2.forEach((element, i) => {
      const ele = { data: element, index: i + testdata.length + 1 };
      numberPChannel.push(ele);
    });
    expect(numberPChannel.heap.length, 'heap should not be empty').be.equal(testdata2.length);
    numberPChannel.push({ data: insert, index: testdata.length });
    expect(numberPChannel.heap.length, 'heap should be empty').be.equal(0);
    expect(numberPChannel.array.length, 'array length should grow').be.equal(testdata.length + testdata2.length + 1);
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    const testdata3 = [1212, 455];
    const dataColletion = testdata.concat(insert).concat(testdata2).concat(testdata3);
    for (let j = 0; j < testdata3.length; j++) {
      numberPChannel.push({ data: testdata3[j], index: testdata.length + testdata2.length + 1 + j });
    }
    setTimeout(() => {
      numberPChannel.abort();
      symbol = true;
    }, 100);
    for await (const element of numberPChannel.generator()) {
      expect(element.data, 'array member should be euqal').be.equal(dataColletion[i++]);
    }
    expect(symbol, 'the Channel be aborted').be.true;
  });

  it('should clear', () => {
    numberPChannel.clear();
    expect(numberPChannel.array.length, 'the PChannel array should be empty').be.equal(0);
    expect(numberPChannel.heap.length, 'the PChannel heap should be empty').be.equal(0);
  });
});
