import { BN, Address } from 'ethereumjs-util';
import { FunctionalSet, FunctionalMap } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { isGenesis } from './genesis';

// validator change information
export type ValidatorChange = {
  // validator address
  validator: Address;
  // validator voting power changed value
  update: BN;
  // new indexed validator voting power
  votingPower?: BN;
};

// a class used to record validator changes
export class ValidatorChanges {
  // common instance
  common: Common;
  // a map to record changes
  changes = new FunctionalMap<Address, ValidatorChange>((a: Address, b: Address) => a.buf.compare(b.buf));
  // new indexed validator address set
  indexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));
  // new unindexed validator address set
  unindexedValidators = new FunctionalSet<Address>((a: Address, b: Address) => a.buf.compare(b.buf));

  constructor(common: Common) {
    this.common = common;
  }

  // get validator change object(create if it does not exist)
  private getChange(validator: Address) {
    let c = this.changes.get(validator);
    if (!c) {
      c = {
        validator: validator,
        update: new BN(0)
      };
      this.changes.set(validator, c);
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
    if (!isGenesis(validator, this.common)) {
      this.unindexedValidators.delete(validator);
      this.indexedValidators.add(validator);
      const vc = this.getChange(validator);
      vc.votingPower = votingPower;
      vc.update = new BN(0);
    }
  }

  /**
   * Delete index for validator,
   * if validator's voting power is less than `minIndexVotingPower`,
   * blockchain will delete validator from validator set
   * @param validator - Validator address
   */
  unindex(validator: Address) {
    if (!isGenesis(validator, this.common)) {
      this.unindexedValidators.add(validator);
      this.indexedValidators.delete(validator);
      this.changes.delete(validator);
    }
  }

  /**
   * Someone stake for validator
   * @param validator - Validator address
   * @param value - Stake amount
   */
  stake(validator: Address, value: BN) {
    if (!isGenesis(validator, this.common)) {
      this.getChange(validator).update.iadd(value);
    }
  }

  /**
   * Someone unstake from validator
   * @param validator - Validator address
   * @param value - Ustake amount
   */
  unstake(validator: Address, value: BN) {
    if (!isGenesis(validator, this.common)) {
      this.getChange(validator).update.isub(value);
    }
  }
}
