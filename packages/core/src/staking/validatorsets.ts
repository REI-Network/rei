import { createBufferFunctionalMap } from '@gxchain2/utils';
import { ValidatorSet } from './validatorset';
import { StakeManager } from './stakemanager';

const maxSize = 101;

/**
 * `ValidatorSets` will record the most recent `maxSize` block of validators set
 */
export class ValidatorSets {
  private sets = createBufferFunctionalMap<ValidatorSet>();
  private roots: Buffer[] = [];

  has(stateRoot: Buffer) {
    return this.sets.has(stateRoot);
  }

  async get(stateRoot: Buffer, sm: StakeManager) {
    let set = this.sets.get(stateRoot);
    if (!set) {
      set = await sm.createValidatorSet();
      this.set(stateRoot, set);
    }
    return set;
  }

  set(stateRoot: Buffer, set: ValidatorSet) {
    this.sets.set(stateRoot, set);
    this.roots.push(stateRoot);
    while (this.roots.length > maxSize) {
      this.sets.delete(this.roots.shift()!);
    }
  }
}
