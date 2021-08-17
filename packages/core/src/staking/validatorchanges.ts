import { BN, Address } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { ValidatorChange } from './validatorset';

export class ValidatorChanges {
  private map = createBufferFunctionalMap<ValidatorChange>();

  private getChange(validator: Address) {
    let c = this.map.get(validator.buf);
    if (!c) {
      c = {
        validator: validator,
        stake: new BN(0),
        unstake: new BN(0)
      };
      this.map.set(validator.buf, c);
    }
    return c;
  }

  stake(validator: Address, value: BN) {
    this.getChange(validator).stake.iadd(value);
  }

  unstake(validator: Address, value: BN) {
    this.getChange(validator).unstake.iadd(value);
  }

  setCommissionRate(validator: Address, commissionRate: BN, updateTimestamp: BN) {
    this.getChange(validator).commissionChange = {
      commissionRate,
      updateTimestamp
    };
  }

  forEach(cb: (vc: ValidatorChange) => void) {
    this.map.forEach((vc) => cb(vc));
  }
}
