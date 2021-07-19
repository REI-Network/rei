import { expect } from 'chai';
import { Channel, HChannel, PChannel } from '../src';

const testdata = [23, 45, 13, 56, 555, 7, 1, 0, 789, 667, 89];
const testdataSorted = [...testdata].sort((a, b) => {
  return a - b;
});
const testdata2 = [90, 3, 886];
class HChanneltest {
  data: number;
  constructor(data: number) {
    this.data = data;
  }
}

describe('Channel', () => {
  const numberChannel = new Channel<number>();
  before(() => {
    testdata.map((hash) => {
      numberChannel.push(hash);
    });
  });

  it('should get array', () => {
    numberChannel.array.map((element, i) => {
      expect(element, 'array member should be euqal').be.equal(testdata[i]);
    });
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    const dataColletion = testdata.concat(testdata2);
    testdata2.map((element) => {
      setTimeout(() => {
        numberChannel.push(element);
      }, 100);
    });
    setTimeout(() => {
      numberChannel.abort();
      symbol = true;
    }, 500);
    for await (const element of numberChannel.generator()) {
      expect(element, 'array member should be euqal').be.equal(dataColletion[i++]);
    }
    expect(symbol, 'Channel be aborted').be.true;
  });

  it('should clear', () => {
    numberChannel.reset();
    testdata.map((hash) => {
      numberChannel.push(hash);
    });
    numberChannel.clear();
    expect(numberChannel.array.length, 'Channel should be empty').be.equal(0);
  });
});

describe('HChannel', () => {
  const numberHChannel = new HChannel<HChanneltest>({ compare: (a, b) => a.data < b.data });
  before(() => {
    testdata.map((element) => {
      numberHChannel.push(new HChanneltest(element));
    });
  });

  it('should get heap', () => {
    let i = 0;
    while (numberHChannel.heap.length > 0) {
      expect(numberHChannel.heap.remove().data, 'heap member should be euqal').be.equal(testdataSorted[i++]);
    }
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    testdata2.map((element) => {
      setTimeout(() => {
        numberHChannel.push(new HChanneltest(element));
      }, 100);
    });
    setTimeout(() => {
      numberHChannel.abort();
      symbol = true;
    }, 500);
    for await (const element of numberHChannel.generator()) {
      expect(element.data, 'heap member should be equal').equal(testdata2[i++]);
    }
    expect(symbol, 'Channel be aborted').be.true;
  });

  it('should clear', () => {
    numberHChannel.reset();
    testdata.map((element) => {
      numberHChannel.push(new HChanneltest(element));
    });
    numberHChannel.clear();
    expect(numberHChannel.heap.length, 'HChannel should be empty').be.equal(0);
  });
});

describe('PChannel', () => {
  const numberPChannel = new PChannel<number>();
  before(() => {
    testdata.map((element, i) => {
      const ele = { data: element, index: i };
      numberPChannel.push(ele);
    });
    testdata2.map((element, i) => {
      const ele = { data: element, index: i + testdata.length + 1 };
      numberPChannel.push(ele);
    });
  });

  it('should readies', () => {
    const insert = 777;
    expect(numberPChannel.heap.length, 'heap should not be empty').be.equal(testdata2.length);
    numberPChannel.push({ data: insert, index: testdata.length });
    expect(numberPChannel.heap.length, 'heap should be empty').be.equal(0);
  });

  it('should generator takes effect', async () => {
    let symbol = false;
    let i = 0;
    const insert = 777;
    const testdata3 = [1212, 455];
    const dataColletion = testdata.concat(777).concat(testdata2).concat(testdata3);
    testdata3.map((element, i) => {
      setTimeout(() => {
        numberPChannel.push({ data: element, index: testdata.length + testdata2.length + 1 + i });
      }, 100);
    });
    setTimeout(() => {
      numberPChannel.abort();
      symbol = true;
    }, 500);
    for await (const element of numberPChannel.generator()) {
      expect(element.data, 'array member should be euqal').be.equal(dataColletion[i++]);
    }
    expect(symbol, 'Channel be aborted').be.true;
  });

  it('should clear', () => {
    numberPChannel.clear();
    expect(numberPChannel.array.length, 'PChannel array should be empty').be.equal(0);
    expect(numberPChannel.heap.length, 'PChannel heap should be empty').be.equal(0);
  });
});
