import { FunctionalBufferMap } from '@rei-network/utils';
import { StakeManager, ValidatorBls } from '../contracts';
import { Reimint } from '../reimint';
import { ValidatorSet, LoadOptions } from './validatorSet';
import { IndexedValidatorSet } from './indexedValidatorSet';
import { ActiveValidatorSet } from './activeValidatorSet';
import { isGenesis, genesisValidatorVotingPower } from './genesis';

const maxSize = 100;

/**
 * `ValidatorSets` will record the most recent `maxSize` block of validators set
 */
export class ValidatorSets {
  private indexedSets = new FunctionalBufferMap<IndexedValidatorSet>();
  private activeSets = new FunctionalBufferMap<ActiveValidatorSet>();
  private indexedRoots: Buffer[] = [];
  private activeRoots: Buffer[] = [];

  /**
   * Get validator set by state root,
   * load from stake manager if it doesn't exist
   * @param stateRoot - Target state root
   * @param sm - `StakeManager` instance
   */
  async getValSet(stateRoot: Buffer, sm?: StakeManager, bls?: ValidatorBls) {
    const indexed = this.indexedSets.get(stateRoot);
    const active = this.activeSets.get(stateRoot);
    if (!indexed || !active) {
      if (!sm) {
        throw new Error('missing state root: ' + stateRoot.toString('hex'));
      }

      let validatorSet: ValidatorSet;
      if (!bls) {
        const { totalLockedAmount, validatorCount } = await sm.getTotalLockedAmountAndValidatorCount();
        const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), sm.common);
        const options: LoadOptions = enableGenesisValidators ? { genesis: true } : { active };
        validatorSet = await ValidatorSet.fromStakeManager(sm, options);
      } else {
        const indexedValidatorSet = await IndexedValidatorSet.fromStakeManager(sm, bls);
        const { totalLockedAmount, validatorCount } = indexedValidatorSet.getTotalLockVotingPower(true);
        const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), sm.common);
        const activeSet = enableGenesisValidators
          ? await ActiveValidatorSet.fromStakeManager(sm, (val) => {
              if (!isGenesis(val, sm.common)) {
                throw new Error('unknown validator: ' + val.toString());
              }
              return genesisValidatorVotingPower.clone();
            })
          : ActiveValidatorSet.fromActiveValidators(indexedValidatorSet.sort(sm.common.param('vm', 'maxValidatorsCount'), true));
        validatorSet = new ValidatorSet(indexedValidatorSet, activeSet);
      }
      this.set(stateRoot, validatorSet);
      return validatorSet;
    } else {
      return new ValidatorSet(indexed, active);
    }
  }

  /**
   * Get active validator set by state root,
   * load from stake manager if it doesn't exist
   * @param stateRoot - Target state root
   * @param sm - `StakeManager` instance
   */
  async getActiveValSet(stateRoot: Buffer, sm?: StakeManager) {
    let active = this.activeSets.get(stateRoot);
    if (!active) {
      if (!sm) {
        throw new Error('missing state root: ' + stateRoot.toString('hex'));
      }

      const { totalLockedAmount, validatorCount } = await sm.getTotalLockedAmountAndValidatorCount();
      const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), sm.common);
      active = await ActiveValidatorSet.fromStakeManager(
        sm,
        enableGenesisValidators
          ? (val) => {
              if (!isGenesis(val, sm.common)) {
                throw new Error('unknown validator: ' + val.toString());
              }

              return genesisValidatorVotingPower.clone();
            }
          : undefined
      );
      this.set(stateRoot, active);
    }
    return active;
  }

  /**
   * Add validator set to memort cache with state root
   * @param stateRoot - Target state root
   * @param set - Validator set
   */
  set(stateRoot: Buffer, value: ValidatorSet | IndexedValidatorSet | ActiveValidatorSet) {
    if (value instanceof IndexedValidatorSet) {
      if (!this.indexedSets.has(stateRoot)) {
        this.indexedSets.set(stateRoot, value);
        this.indexedRoots.push(stateRoot);
        while (this.indexedRoots.length > maxSize) {
          this.indexedSets.delete(this.indexedRoots.shift()!);
        }
      }
    } else if (value instanceof ActiveValidatorSet) {
      if (!this.activeSets.has(stateRoot)) {
        this.activeSets.set(stateRoot, value);
        this.activeRoots.push(stateRoot);
        while (this.activeRoots.length > maxSize) {
          this.activeSets.delete(this.activeRoots.shift()!);
        }
      }
    } else {
      this.set(stateRoot, value.indexed);
      this.set(stateRoot, value.active);
    }
  }
}
