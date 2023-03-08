import { Common } from '@rei-network/common';
import { StakeManager, ValidatorBls } from '../contracts';
import { IndexedValidatorSet } from './indexedValidatorSet';
import { ActiveValidatorSet } from './activeValidatorSet';
import { isGenesis, genesisValidatorVotingPower } from './genesis';
import { ValidatorChanges } from './validatorChanges';

export interface LoadOptions {
  // whether to sort the set of validators or load directly from the state tree
  sort?: boolean;
  // is it a genesis validator set
  genesis?: boolean;
  // active validator set
  active?: ActiveValidatorSet;
  // validator bls contract
  bls?: ValidatorBls;
}

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
