import { createBufferFunctionalMap } from '@gxchain2/utils';
import { ValidatorSet } from './validatorset';
import { StakeManager } from '../contracts';

const maxSize = 120;

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
      set = await ValidatorSet.createFromStakeManager(sm);
      this.set(stateRoot, set);
    }
    return set;
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
