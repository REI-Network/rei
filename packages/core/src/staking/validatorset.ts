import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { StakeManager, Validator } from '../contracts';
import { ValidatorChanges } from './validatorchanges';

let genesisValidators: Address[] | undefined;

export type ValidatorInfo = {
  validator: Address;
  votingPower: BN;
  detail?: Validator;
};

function cloneInfo(info: ValidatorInfo) {
  return {
    ...info,
    votingPower: info.votingPower.clone()
  };
}

export type ValidatorChange = {
  validator: Address;
  stake: BN;
  unstake: BN;
  votingPower?: BN;
  commissionChange?: {
    commissionRate: BN;
    updateTimestamp: BN;
  };
};

export class ValidatorSet {
  private map = createBufferFunctionalMap<ValidatorInfo>();
  private active: Address[] = [];
  private common: Common;

  constructor(common: Common) {
    this.common = common;
  }

  static createFromValidatorSet(old: ValidatorSet, common: Common) {
    const vs = new ValidatorSet(common);
    for (const [validator, info] of old.map) {
      vs.map.set(validator, cloneInfo(info));
    }
    vs.active = [...old.active];
    return vs;
  }

  static createFromValidatorInfo(info: ValidatorInfo[], common: Common) {
    const vs = new ValidatorSet(common);
    for (const v of info) {
      vs.map.set(v.validator.buf, v);
    }
    vs.sort();
    return vs;
  }

  static async createFromStakeManager(sm: StakeManager) {
    const validators: ValidatorInfo[] = [];
    const length = await sm.indexedValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        validators.push({ validator, votingPower });
      }
    }
    return ValidatorSet.createFromValidatorInfo(validators, sm.common);
  }

  static createGenesisValidatorSet(common: Common) {
    return ValidatorSet.createFromValidatorInfo([], common);
  }

  private sort() {
    const maxCount = this.common.param('vm', 'maxValidatorsCount');
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      comparBefore: (a: ValidatorInfo, b: ValidatorInfo) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
        }
        return num;
      }
    });
    for (const v of this.map.values()) {
      heap.push(v);
      // if the heap size is too large, remove the minimum one
      while (heap.size > maxCount) {
        const droped: ValidatorInfo = heap.remove();
        // delete the detail information of the removed validator to save memory
        droped.detail = undefined;
      }
    }
    this.active = [];
    while (heap.length > 0) {
      this.active.unshift(heap.remove().validator);
    }
    // get genesis validators from common
    if (!genesisValidators) {
      genesisValidators = this.common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
      // sort by address
      genesisValidators.sort((a, b) => -1 * (a.buf.compare(b.buf) as 1 | -1 | 0));
    }
    const gvs = [...genesisValidators];
    // if the validator is not enough, push the genesis validator to the active list,
    // the genesis validator sorted by address and has nothing to do with voting power
    while (gvs.length > 0 && this.active.length < maxCount) {
      const gv = gvs.shift()!;
      if (this.active.filter((validator) => validator.equals(gv)).length === 0) {
        this.active.push(gv);
      }
    }
  }

  private getValidator(validator: Address) {
    let v = this.map.get(validator.buf);
    if (!v) {
      v = {
        validator: validator,
        votingPower: new BN(0)
      };
      this.map.set(validator.buf, v);
    }
    return v;
  }

  // TODO: if the changed validator is an active validator, the active list maybe not be dirty
  mergeChanges(changes: ValidatorChanges) {
    let dirty = false;

    for (const uv of changes.unindexedValidators) {
      this.map.delete(uv.buf);
    }

    for (const vc of changes.changes.values()) {
      const stake = vc.stake;
      const unstake = vc.unstake;
      let v: ValidatorInfo | undefined;
      if (vc.votingPower) {
        dirty = true;
        v = this.getValidator(vc.validator);
        v.votingPower = vc.votingPower;
      }

      if (stake.gt(unstake)) {
        dirty = true;
        v = v ?? this.getValidator(vc.validator);
        v.votingPower.iadd(stake.sub(unstake));
      } else if (stake.lt(unstake)) {
        dirty = true;
        v = v ?? this.getValidator(vc.validator);
        v.votingPower.isub(unstake.sub(stake));
        if (v.votingPower.isZero()) {
          this.map.delete(vc.validator.buf);
        }
      }

      if (!v && vc.commissionChange) {
        v = this.map.get(vc.validator.buf);
      }

      // only care about validators with detailed information
      if (vc.commissionChange && v && v.detail) {
        v.detail.commissionRate = vc.commissionChange.commissionRate;
        v.detail.updateTimestamp = vc.commissionChange.updateTimestamp;
      }
    }

    if (dirty) {
      this.sort();
    }
  }

  async getActiveValidatorDetail(validator: Address, sm: StakeManager) {
    const index = this.active.findIndex((v) => v.equals(validator));
    if (index === -1) {
      return undefined;
    }
    const v = this.map.get(validator.buf);
    return v ? v.detail ?? (v.detail = await sm.validators(validator)) : await sm.validators(validator);
  }

  activeSigners() {
    return [...this.active];
  }

  copy(common: Common) {
    return ValidatorSet.createFromValidatorSet(this, common);
  }
}
