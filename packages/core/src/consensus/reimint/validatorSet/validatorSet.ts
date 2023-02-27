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

  /**
   * Load validator set from state trie
   * @param sm - Stake manager instance
   * @param options - Load options
   * @returns ValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager, options?: LoadOptions) {
    let active: ActiveValidatorSet;
    const indexed = await IndexedValidatorSet.fromStakeManager(sm, options?.bls);
    const minCount = sm.common.param('vm', 'minValidatorsCount');
    if (options?.genesis || indexed.length < minCount) {
      active = await ActiveValidatorSet.fromStakeManager(sm, (val) => {
        if (!isGenesis(val, sm.common)) {
          throw new Error('unknown validator: ' + val.toString());
        }
        return genesisValidatorVotingPower.clone();
      });
    } else {
      if (options?.sort) {
        const maxCount = sm.common.param('vm', 'maxValidatorsCount');
        active = ActiveValidatorSet.fromActiveValidators(indexed.sort(maxCount));
        // now, the priority of active validator is all 0
      } else if (options?.active) {
        active = options.active;
      } else {
        active = await ActiveValidatorSet.fromStakeManager(sm, (val) => indexed.getVotingPower(val));
      }
    }

    return new ValidatorSet(indexed, active);
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @returns ValidatorSet instance
   */
  static genesis(common: Common) {
    const indexed = IndexedValidatorSet.genesis(common);
    const active = ActiveValidatorSet.genesis(common);
    return new ValidatorSet(indexed, active);
  }

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

  /**
   * Copy self and merge changes
   * @param changes - Validator set changes
   * @param common - Common instance
   * @returns New ValidatorSet instance
   */
  async copyAndMerge(changes: ValidatorChanges, common: Common, bls?: ValidatorBls) {
    const indexed = this.indexed.copy();
    const active = this.active.copy();
    if (await indexed.merge(changes, bls)) {
      const maxCount = common.param('vm', 'maxValidatorsCount');
      active.merge(indexed.sort(maxCount));
      active.computeNewPriorities(this.active);
    }
    return new ValidatorSet(indexed, active);
  }
}
