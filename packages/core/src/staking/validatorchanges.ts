import { BN, Address } from 'ethereumjs-util';
import { createBufferFunctionalMap, FunctionalSet } from '@gxchain2/utils';
import { ValidatorSet } from './validatorset';

// validator change information
export type ValidatorChange = {
  // validator address
  validator: Address;
  // validator voting power changed value
  update: BN;
  // new indexed validator voting power
  votingPower?: BN;
  // commission rate change information
  commissionChange?: {
    // new commission rate
    commissionRate: BN;
    // new commission rate update timestamp
    updateTimestamp: BN;
  };
};

// a class used to record validator changes
export class ValidatorChanges {
  // validator set of parent block
  parent: ValidatorSet;
  // a map to record changes
  changes = createBufferFunctionalMap<ValidatorChange>();
  // new indexed validator address set
  indexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));
  // new unindexed validator address set
  unindexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));

  constructor(parent: ValidatorSet) {
    this.parent = parent;
  }

  // get validator change object(create if it does not exist)
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

  /**
   * Create index for validator,
   * if the voting power of a validator who was not in the validator set before is greater than `minIndexVotingPower`,
   * blockchain will add him to the validator set
   * @param validator - Validator address
   * @param votingPower - Voting power
   */
  index(validator: Address, votingPower: BN) {
    this.unindexedValidators.delete(validator);
    this.indexedValidators.add(validator);
    const vc = this.getChange(validator);
    vc.votingPower = votingPower;
    vc.update = new BN(0);
  }

  /**
   * Delete index for validator,
   * if validator's voting power is less than `minIndexVotingPower`,
   * blockchain will delete validator from validator set
   * @param validator - Validator address
   */
  unindex(validator: Address) {
    this.unindexedValidators.add(validator);
    this.indexedValidators.delete(validator);
    this.changes.delete(validator.buf);
  }

  // check if validator changes can be ignored
  private cannonIgnore(validator: Address) {
    return (this.parent.contains(validator) || this.indexedValidators.has(validator)) && !this.unindexedValidators.has(validator);
  }

  /**
   * Someone stake for validator
   * @param validator - Validator address
   * @param value - Stake amount
   */
  stake(validator: Address, value: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).update.iadd(value);
    }
  }

  /**
   * Someone unstake from validator
   * @param validator - Validator address
   * @param value - Ustake amount
   */
  unstake(validator: Address, value: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).update.isub(value);
    }
  }

  /**
   * Validator set a new commission rate
   * @param validator - Validator address
   * @param commissionRate - New commission rate
   * @param updateTimestamp - New update timestamp
   */
  setCommissionRate(validator: Address, commissionRate: BN, updateTimestamp: BN) {
    if (this.cannonIgnore(validator)) {
      this.getChange(validator).commissionChange = {
        commissionRate,
        updateTimestamp
      };
    }
  }
}