import { Common } from '@rei-network/common';
import { IndexedValidatorSet } from './indexedValidatorSet';
import { ActiveValidatorSet } from './activeValidatorSet';

export class ValidatorSet {
  readonly indexed: IndexedValidatorSet;
  readonly active: ActiveValidatorSet;

  constructor(indexed: IndexedValidatorSet, active: ActiveValidatorSet) {
    this.indexed = indexed;
    this.active = active;
  }

  /**
   * Check validator set is a genesis validator set,
   * the genesis validator set contains only the genesis validator
   * @returns `true` if it is
   */
  isGenesis(common: Common) {
    return this.active.isGenesis(common);
  }

  /**
   * Copy validator set
   * @returns ValidatorSet instance
   */
  copy() {
    return new ValidatorSet(this.indexed.copy(), this.active.copy());
  }
}
