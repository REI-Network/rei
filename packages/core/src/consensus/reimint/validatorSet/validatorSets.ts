import { createBufferFunctionalMap } from '@rei-network/utils';
import { ValidatorSet } from './validatorSet';
import { StakeManager } from '../contracts';
import { Reimint } from '../reimint';

const maxSize = 100;

/**
 * `ValidatorSets` will record the most recent `maxSize` block of validators set
 */
export class ValidatorSets {
  private sets = createBufferFunctionalMap<ValidatorSet>();
  private roots: Buffer[] = [];

  /**
   * Check whether state root exists in set
   * @param stateRoot - Target state root
   * @returns `true` if it is exist
   */
  has(stateRoot: Buffer) {
    return this.sets.has(stateRoot);
  }

  /**
   * Get validator set by state root,
   * create if it doesn't exist
   * @param stateRoot - Target state root
   * @param sm - `StakeManager` instance
   * @returns
   */
  async get(stateRoot: Buffer, sm: StakeManager) {
    let set = this.sets.get(stateRoot);
    if (!set) {
      const { totalLockedAmount, validatorCount } = await sm.getTotalLockedAmountAndValidatorCount();
      const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), sm.common);
      set = enableGenesisValidators ? await ValidatorSet.createGenesisValidatorSetFromStakeManager(sm) : await ValidatorSet.createFromStakeManager(sm);
      this.set(stateRoot, set);
    }
    return set;
  }

  directlyGet(stateRoot: Buffer) {
    return this.sets.get(stateRoot);
  }

  /**
   * Set validator set with state root
   * @param stateRoot - Target state root
   * @param set - Validator set
   */
  set(stateRoot: Buffer, set: ValidatorSet) {
    this.sets.set(stateRoot, set);
    this.roots.push(stateRoot);
    while (this.roots.length > maxSize) {
      this.sets.delete(this.roots.shift()!);
    }
  }
}
