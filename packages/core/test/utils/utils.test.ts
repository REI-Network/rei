import { expect } from 'chai';
import { assert } from 'console';
import { randomBytes } from 'crypto';
import { BN } from 'ethereumjs-util';
import { validatorsDecode, validatorsEncode } from '../../src/utils';

describe('ValidatorsEncoder', () => {
  const d1: BN[] = [];
  const d2: BN[] = [];
  const length = Math.round(Math.random() * 21);

  for (let i = 0; i < length; i++) {
    d1.push(new BN(randomBytes(Math.round(Math.random() * 32)))); //random id
    const negativeFlag = Math.random() > 0.5;
    const bn = new BN(randomBytes(Math.round(Math.random() * 32)));
    negativeFlag ? d2.push(bn.neg()) : d2.push(bn); //random priority
  }

  it('should catch list length exception', () => {
    expect(() => validatorsEncode(d1, [])).to.throw('validators length not equal priorities length');
    expect(() => validatorsEncode([], d2)).to.throw('validators length not equal priorities length');
  });

  it('should decode buffer to validators index list and priority list', async () => {
    console.log('d1', d1);
    console.log('d2', d2);
    const buffer = validatorsEncode(d1, d2);
    const { ids, priorities } = validatorsDecode(buffer);
    console.log('ids', ids);
    console.log('priorities', priorities);
    expect(ids.length).to.be.eq(length);
    expect(priorities.length).to.be.eq(length);
    for (let i = 0; i < priorities.length; i++) {
      assert(ids[i].eq(d1[i]));
      assert(priorities[i].eq(d2[i]));
    }
  });
});
