import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap, logger } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { StakeManager, Validator } from '../contracts';

export type ValidatorInfo = {
  validator: Address;
  votingPower: BN;
  detail?: Validator;
};

export type ValidatorChange = {
  validator: Address;
  stake: BN[];
  unstake: BN[];
  commissionChange?: {
    commissionRate: BN;
    updateTimestamp: BN;
  };
};

export class ValidatorSet {
  private map = createBufferFunctionalMap<ValidatorInfo>();
  private active: ValidatorInfo[] = [];
  private common: Common;

  constructor(common: Common) {
    this.common = common;
  }

  static createFromValidatorSet(old: ValidatorSet, common: Common) {
    const vs = new ValidatorSet(common);
    for (const [validator, info] of old.map) {
      vs.map.set(validator, info);
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
    const max = this.common.param('vm', 'maxValidatorsCount');
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
      while (heap.size > max) {
        const droped: ValidatorInfo = heap.remove();
        // delete the detail information of the removed validator to save memory
        droped.detail = undefined;
      }
    }
    this.active = [];
    while (heap.length > 0) {
      this.active.push(heap.remove());
    }
    if (this.active.length < max) {
      // get genesis validators from common
      let genesisValidators: Address[] = this.common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr));
      // filter the genesis validator that already exist in `this.active`
      genesisValidators = genesisValidators.filter((addr) => this.active.filter(({ validator }) => validator.equals(addr)).length === 0);
      genesisValidators.sort((a, b) => -1 * (a.buf.compare(b.buf) as 1 | -1 | 0));
      // if the validator is not enough, push the genesis validator to the active list
      while (genesisValidators.length > 0 && this.active.length < max) {
        this.active.push({
          validator: genesisValidators.shift()!,
          votingPower: new BN(0)
        });
      }
    }
    // sort
    this.active.sort((a: ValidatorInfo, b: ValidatorInfo) => {
      let num = a.votingPower.cmp(b.votingPower) * -1;
      if (num === 0) {
        num = -1 * (a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0);
      }
      return num;
    });
  }

  // TODO: if the changed validator is an active validator, the active list maybe not be dirty
  mergeChanges(changes: ValidatorChange[]) {
    let dirty = false;
    for (const vc of changes) {
      const stake = vc.stake.reduce((sum, v) => sum.add(v), new BN(0));
      const unstake = vc.unstake.reduce((sum, v) => sum.add(v), new BN(0));
      let v: ValidatorInfo | undefined;
      if (stake.gt(unstake)) {
        dirty = true;
        v = this.map.get(vc.validator.buf);
        if (!v) {
          v = {
            validator: vc.validator,
            votingPower: stake.sub(unstake)
          };
          this.map.set(vc.validator.buf, v);
        } else {
          v.votingPower.iadd(stake.sub(unstake));
        }
      } else if (stake.lt(unstake)) {
        v = this.map.get(vc.validator.buf);
        if (!v) {
          // this shouldn't happen
          logger.warn(`ValidatorSet::processChanges, missing validator information: ${vc.validator.toString()}`);
        } else {
          dirty = true;
          v.votingPower.isub(unstake.sub(stake));
          if (v.votingPower.isZero()) {
            this.map.delete(vc.validator.buf);
          }
        }
      }

      if (!v && vc.commissionChange) {
        v = this.map.get(vc.validator.buf);
        if (!v) {
          // this shouldn't happen
          logger.warn(`ValidatorSet::processChanges, missing validator information: ${vc.validator.toString()}`);
        }
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
    let index = this.active.findIndex(({ validator: v }) => v.equals(validator));
    if (index === -1) {
      return undefined;
    }
    return this.active[index].detail ?? (this.active[index].detail = await sm.validators(validator));
  }

  async activeValidators(sm: StakeManager) {
    for (const v of this.active) {
      if (!v.detail) {
        v.detail = await sm.validators(v.validator);
      }
    }
    return [...this.active];
  }

  activeSigners() {
    return this.active.map(({ validator }) => validator);
  }

  copy(common: Common) {
    return ValidatorSet.createFromValidatorSet(this, common);
  }
}
