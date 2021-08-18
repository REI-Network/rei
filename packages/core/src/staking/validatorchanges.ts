import { BN, Address } from 'ethereumjs-util';
import { createBufferFunctionalMap, FunctionalSet } from '@gxchain2/utils';
import { ValidatorChange } from './validatorset';

export class ValidatorChanges {
  changes = createBufferFunctionalMap<ValidatorChange>();
  unindexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));

  private getChange(validator: Address) {
    let c = this.changes.get(validator.buf);
    if (!c) {
      c = {
        validator: validator,
        stake: new BN(0),
        unstake: new BN(0)
      };
      this.changes.set(validator.buf, c);
    }
    return c;
  }

  index(validator: Address, votingPower: BN) {
    this.unindexedValidators.delete(validator);
    const vc = this.getChange(validator);
    vc.votingPower = votingPower;
    vc.stake = new BN(0);
    vc.unstake = new BN(0);
  }

  unindex(validator: Address) {
    this.unindexedValidators.add(validator);
    this.changes.delete(validator.buf);
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
}
