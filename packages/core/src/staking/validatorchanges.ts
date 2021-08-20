import { BN, Address } from 'ethereumjs-util';
import { createBufferFunctionalMap, FunctionalSet } from '@gxchain2/utils';
import { ValidatorSet } from './validatorset';

export type ValidatorChange = {
  validator: Address;
  update: BN;
  votingPower?: BN;
  commissionChange?: {
    commissionRate: BN;
    updateTimestamp: BN;
  };
};

export class ValidatorChanges {
  parent: ValidatorSet;
  changes = createBufferFunctionalMap<ValidatorChange>();
  indexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));
  unindexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));

  constructor(parent: ValidatorSet) {
    this.parent = parent;
  }

  private getChange(validator: Address) {
    let c = this.changes.get(validator.buf);
    if (!c) {
      c = {
        validator: validator,
        update: new BN(0)
      };
      this.changes.set(validator.buf, c);
    }
    return c;
  }

  index(validator: Address, votingPower: BN) {
    this.unindexedValidators.delete(validator);
    this.indexedValidators.add(validator);
    const vc = this.getChange(validator);
    vc.votingPower = votingPower;
    vc.update = new BN(0);
  }

  unindex(validator: Address) {
    this.unindexedValidators.add(validator);
    this.indexedValidators.delete(validator);
    this.changes.delete(validator.buf);
  }

  private cannonIgnore(validator: Address) {
    return (this.parent.contains(validator) || this.indexedValidators.has(validator)) && !this.unindexedValidators.has(validator);
  }

  stake(validator: Address, value: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).update.iadd(value);
    }
  }

  unstake(validator: Address, value: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).update.isub(value);
    }
  }

  setCommissionRate(validator: Address, commissionRate: BN, updateTimestamp: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).commissionChange = {
        commissionRate,
        updateTimestamp
      };
    }
  }
}
