import { expect } from 'chai';
import { assert } from 'console';
import { randomBytes } from 'crypto';
import { BN } from 'ethereumjs-util';
import { validatorsDecode, validatorsEncode } from '../../src/consensus/reimint/contracts/utils';

describe('ValidatorsEncoder', () => {
  let length = 0;
  let idList: BN[] = [];
  let priorityList: BN[] = [];

  beforeEach(() => {
    idList = [];
    priorityList = [];
    length = Math.round(Math.random() * 21) ?? 1;
    for (let i = 0; i < length; i++) {
      idList.push(new BN(getRandomBytes(Math.round(Math.random() * 32)))); //random id
      const negativeFlag = Math.random() > 0.5;
      const bn = new BN(getRandomBytes(Math.round(Math.random() * 32)));
      negativeFlag ? priorityList.push(bn.neg()) : priorityList.push(bn); //random priority
    }
  });

  it('should catch list length exception', () => {
    expect(() => validatorsEncode(idList, [])).to.throw('validators length not equal priorities length');
    expect(() => validatorsEncode([], priorityList)).to.throw('validators length not equal priorities length');
  });

  it('should encode and decode validator random length data', async () => {
    const buffer = validatorsEncode(idList, priorityList);
    const { ids, priorities } = validatorsDecode(buffer);
    expect(ids.length).to.be.eq(length);
    expect(priorities.length).to.be.eq(length);
    for (let i = 0; i < priorities.length; i++) {
      assert(ids[i].eq(idList[i]));
      assert(priorities[i].eq(priorityList[i]));
    }
  });

  it('should encode and decode validator edge data', async () => {
    const idList: BN[] = [];
    const priorityList: BN[] = [];
    for (let i = 0; i <= 255; i++) {
      idList.push(new BN(i));
      i % 2 === 0 ? priorityList.push(new BN(getRandomBytes(32)).neg()) : priorityList.push(new BN(getRandomBytes(32)));
    }
    const buffer = validatorsEncode(idList, priorityList);
    const { ids, priorities } = validatorsDecode(buffer);
    expect(ids.length).to.be.eq(256);
    expect(priorities.length).to.be.eq(256);
    for (let i = 0; i < priorities.length; i++) {
      assert(ids[i].eq(idList[i]));
      assert(priorities[i].eq(priorityList[i]));
    }
  });

  it('should encode and decode validator different length data', async () => {
    const idList: BN[] = [];
    const priorityList: BN[] = [];
    for (let i = 0; i <= 32; i++) {
      idList.push(new BN(getRandomBytes(i)));
      i % 2 === 0 ? priorityList.push(new BN(getRandomBytes(i)).neg()) : priorityList.push(new BN(getRandomBytes(i)));
    }
    const buffer = validatorsEncode(idList, priorityList);
    const { ids, priorities } = validatorsDecode(buffer);
    expect(ids.length).to.be.eq(33);
    expect(priorities.length).to.be.eq(33);
    for (let i = 0; i < priorities.length; i++) {
      assert(ids[i].eq(idList[i]));
      assert(priorities[i].eq(priorityList[i]));
    }
  });
});

function getRandomBytes(length: number) {
  let random = randomBytes(length);
  while (random[0] === 0) {
    random = randomBytes(length);
  }
  return random;
}
