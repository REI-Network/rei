import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { FunctionalAddressMap, FunctionalAddressSet } from '@rei-network/utils';
import { StakeManager, ValidatorBls } from '../contracts';
import { ValidatorChanges } from './validatorChanges';
import { isGenesis } from './genesis';

// validator information
export type IndexedValidator = {
  // validator address
  validator: Address;
  // voting power
  votingPower: BN;
  // validator bls public key
  blsPublicKey?: Buffer;
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
   * @param sm - `StakeManager` instance
   * @param bls - `ValidatorBls` instance
   * @returns IndexedValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager, bls?: ValidatorBls) {
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
        const indexValidator: IndexedValidator = { validator, votingPower };
        if (bls) {
          indexValidator.blsPublicKey = await bls.getBlsPublicKey(validator);
        }
        indexed.set(validator, indexValidator);
      }
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
   * Merge validator set changes
   * @param changes - `ValidatorChanges` instance
   * @param bls - `ValidatorBls` instance
   */
  async merge(changes: ValidatorChanges, bls?: ValidatorBls) {
    for (const uv of changes.unindexedValidators) {
      this.indexed.delete(uv);
    }

    const newValidators = new FunctionalAddressSet();
    for (const vc of changes.changes.values()) {
      let v: IndexedValidator | undefined;
      if (vc.votingPower) {
        v = this.getValidator(vc.validator);
        v.votingPower = vc.votingPower;
        newValidators.add(vc.validator);
      }

      if (!vc.update.eqn(0) && this.indexed.get(vc.validator)) {
        v = v ?? this.getValidator(vc.validator);
        v.votingPower.iadd(vc.update);
        if (v.votingPower.isZero()) {
          this.indexed.delete(vc.validator);
          changes.blsValidators.delete(vc.validator);
          newValidators.delete(vc.validator);
        }
      }
    }

    for (const addr of newValidators) {
      if (!changes.blsValidators.has(addr) && bls) {
        const blsPublicKey = await bls.getBlsPublicKey(addr);
        if (blsPublicKey) {
          changes.blsValidators.set(addr, blsPublicKey);
        }
      }
    }

    for (const [addr, blsPublicKey] of changes.blsValidators) {
      if (this.contains(addr)) {
        this.getValidator(addr).blsPublicKey = blsPublicKey;
      }
    }
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
   * @param flag - Filter bls public key or not
   * @returns - Active validator list
   */
  sort(maxCount: number, flag?: boolean) {
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      compar: (a: IndexedValidator, b: IndexedValidator) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
          num *= -1;
        }
        return num;
      }
    });

    const indexed = flag ? Array.from(this.indexed.values()).filter((v) => v.blsPublicKey !== undefined) : this.indexed.values();
    for (const v of indexed) {
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

    // sort active validators
    activeValidators.sort((a, b) => {
      let num = a.votingPower.cmp(b.votingPower);
      num *= -1;
      if (num === 0) {
        num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
      }
      return num;
    });

    return activeValidators;
  }

  /**
   * Get total locked voting power and validator count
   * @param flag - Whether to filter out validators without bls public key
   * @returns Total locked voting power and validator count
   */
  getTotalLockedVotingPowerAndValidatorCount(flag?: boolean) {
    const totalLockedAmount = new BN(0);
    const validatorCount = new BN(0);
    if (flag) {
      for (const v of this.indexed.values()) {
        if (v.blsPublicKey !== undefined) {
          totalLockedAmount.iadd(v.votingPower);
          validatorCount.iaddn(1);
        }
      }
    } else {
      for (const v of this.indexed.values()) {
        totalLockedAmount.iadd(v.votingPower);
        validatorCount.iaddn(1);
      }
    }
    return { totalLockedAmount, validatorCount };
  }
}
