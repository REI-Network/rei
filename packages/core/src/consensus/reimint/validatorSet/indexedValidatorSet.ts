import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { FunctionalAddressMap } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { StakeManager } from '../contracts';
import { ValidatorChanges } from './validatorChanges';
import { isGenesis, getGenesisValidators, genesisValidatorVotingPower } from './genesis';

// validator information
export type IndexedValidator = {
  // validator address
  validator: Address;
  // voting power
  votingPower: BN;
};

// copy a `IndexedValidator`
function copyIndexedValidator(info: IndexedValidator) {
  return {
    ...info,
    votingPower: info.votingPower.clone()
  };
}

export class IndexedValidatorSet {
  // indexed validator set
  readonly indexed: Map<Address, IndexedValidator>;

  /**
   * Load indexed validator set from state trie
   * @param sm - Stake manager instance
   * @returns IndexedValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager) {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    const length = await sm.indexedValidatorsLength();
    for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      // exclude genesis validators
      if (isGenesis(validator, sm.common)) {
        continue;
      }

      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        indexed.set(validator, {
          validator,
          votingPower
        });
      }
    }

    return new IndexedValidatorSet(indexed);
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @returns IndexedValidatorSet instance
   */
  static genesis(common: Common) {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    for (const gv of getGenesisValidators(common)) {
      indexed.set(gv, {
        validator: gv,
        votingPower: genesisValidatorVotingPower.clone()
      });
    }
    return new IndexedValidatorSet(indexed);
  }

  constructor(indexed: Map<Address, IndexedValidator>) {
    this.indexed = indexed;
  }

  /**
   * Get indexed validator length
   */
  get length() {
    return this.indexed.size;
  }

  // get validator object by address(create if it does not exist)
  private getValidator(validator: Address) {
    let v = this.indexed.get(validator);
    if (!v) {
      v = {
        validator: validator,
        votingPower: new BN(0)
      };
      this.indexed.set(validator, v);
    }
    return v;
  }

  /**
   * Get validator voting power by address
   * @param validator - Address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    const vp = this.indexed.get(validator)?.votingPower.clone();
    if (!vp) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return vp;
  }

  /**
   * Check whether validator is indexed
   * @param validator - Validator address
   * @returns `true` if it is indexed
   */
  contains(validator: Address) {
    return this.indexed.has(validator);
  }

  /**
   * Check validator set is a genesis validator set,
   * the genesis validator set contains only the genesis validator
   * @returns `true` if it is
   */
  isGenesis(common: Common) {
    const genesisValidators = getGenesisValidators(common);
    if (genesisValidators.length !== this.length) {
      return false;
    }

    for (const gv of genesisValidators) {
      if (!this.contains(gv)) {
        return false;
      }
      if (!this.getVotingPower(gv).eq(genesisValidatorVotingPower)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Merge validator set changes
   * @param changes - `ValidatorChanges` instance
   */
  merge(changes: ValidatorChanges) {
    // TODO: if the changed validator is an active validator, the active list maybe not be dirty
    let dirty = false;

    for (const uv of changes.unindexedValidators) {
      this.indexed.delete(uv);
    }

    for (const vc of changes.changes.values()) {
      let v: IndexedValidator | undefined;
      if (vc.votingPower) {
        dirty = true;
        v = this.getValidator(vc.validator);
        v.votingPower = vc.votingPower;
      }

      if (!vc.update.eqn(0)) {
        dirty = true;
        v = v ?? this.getValidator(vc.validator);
        v.votingPower.iadd(vc.update);
        if (v.votingPower.isZero()) {
          this.indexed.delete(vc.validator);
        }
      }
    }

    return dirty;
  }

  /**
   * Copy a new indexed validator set
   * @returns New indexed validator set
   */
  copy() {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    for (const [addr, validator] of this.indexed) {
      indexed.set(addr, copyIndexedValidator(validator));
    }
    return new IndexedValidatorSet(indexed);
  }

  /**
   * Sort for a active validator list
   * @param maxCount - Max active validator count
   * @returns - Active validator list
   */
  sort(maxCount: number) {
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      compar: (a: IndexedValidator, b: IndexedValidator) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
        }
        return num;
      }
    });

    for (const v of this.indexed.values()) {
      heap.push(v);
      // if the heap length is too large, remove the minimum one
      while (heap.length > maxCount) {
        heap.remove();
      }
    }

    // sort validators
    const activeValidators: IndexedValidator[] = [];
    while (heap.length > 0) {
      const v = heap.remove() as IndexedValidator;
      activeValidators.push(v);
    }

    return activeValidators;
  }
}
