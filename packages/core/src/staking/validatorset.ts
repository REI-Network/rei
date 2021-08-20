import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { StakeManager, Validator, ActiveValidator } from '../contracts';
import { ValidatorChanges } from './validatorchanges';

const priorityWindowSizeFactor = 2;
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
  update: BN;
  votingPower?: BN;
  commissionChange?: {
    commissionRate: BN;
    updateTimestamp: BN;
  };
};

export class ValidatorSet {
  private validators = createBufferFunctionalMap<ValidatorInfo>();
  private active: ActiveValidator[] = [];
  private totalVotingPower = new BN(0);
  private common: Common;

  constructor(common: Common) {
    this.common = common;
  }

  static createFromValidatorSet(old: ValidatorSet, common: Common) {
    const vs = new ValidatorSet(common);
    for (const [validator, info] of old.validators) {
      vs.validators.set(validator, cloneInfo(info));
    }
    vs.active = [...old.active];
    return vs;
  }

  static createFromValidatorInfo(info: ValidatorInfo[], common: Common) {
    const vs = new ValidatorSet(common);
    for (const v of info) {
      vs.validators.set(v.validator.buf, v);
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
    for (const v of this.validators.values()) {
      heap.push(v);
      // if the heap size is too large, remove the minimum one
      while (heap.size > maxCount) {
        const droped: ValidatorInfo = heap.remove();
        // delete the detail information of the removed validator to save memory
        droped.detail = undefined;
      }
    }

    // sort validators
    const newAcitve: ActiveValidator[] = [];
    const totalVotingPower = new BN(0);
    while (heap.length > 0) {
      const v = heap.remove() as ValidatorInfo;
      newAcitve.unshift({
        validator: v.validator,
        priority: new BN(0)
      });
      totalVotingPower.iadd(v.votingPower);
    }

    // if the validator is not enough, push the genesis validator to the active list
    if (newAcitve.length < maxCount) {
      // get genesis validators from common
      if (!genesisValidators) {
        genesisValidators = this.common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
        // sort by address
        genesisValidators.sort((a, b) => -1 * (a.buf.compare(b.buf) as 1 | -1 | 0));
      }
      const gvs = [...genesisValidators];
      // the genesis validator sorted by address and has nothing to do with voting power
      while (gvs.length > 0 && newAcitve.length < maxCount) {
        const gv = gvs.shift()!;
        if (newAcitve.filter(({ validator }) => validator.equals(gv)).length === 0) {
          newAcitve.push({
            validator: gv,
            priority: new BN(0)
          });
        }
      }
    }

    return { newAcitve, totalVotingPower };
  }

  private computeNewPriorities(newAcitve: ActiveValidator[], tvpAfterUpdatesBeforeRemovals: BN) {
    let newPriority: BN | undefined;
    for (const av of newAcitve) {
      const index = this.active.findIndex(({ validator }) => validator.equals(av.validator));
      if (index !== -1) {
        av.priority = this.active[index].priority;
      } else {
        if (newPriority === undefined) {
          // - 1.25 * tvpAfterUpdatesBeforeRemovals
          newPriority = tvpAfterUpdatesBeforeRemovals.muln(10).divn(8).neg();
        }
        av.priority = newPriority.clone();
      }
    }
  }

  private getValidator(validator: Address) {
    let v = this.validators.get(validator.buf);
    if (!v) {
      v = {
        validator: validator,
        votingPower: new BN(0)
      };
      this.validators.set(validator.buf, v);
    }
    return v;
  }

  // TODO: if the changed validator is an active validator, the active list maybe not be dirty
  mergeChanges(changes: ValidatorChanges) {
    let dirty = false;

    for (const uv of changes.unindexedValidators) {
      this.validators.delete(uv.buf);
    }

    for (const vc of changes.changes.values()) {
      let v: ValidatorInfo | undefined;
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
          this.validators.delete(vc.validator.buf);
        }
      }

      if (!v && vc.commissionChange) {
        v = this.validators.get(vc.validator.buf);
      }

      // only care about validators with detailed information
      if (vc.commissionChange && v && v.detail) {
        v.detail.commissionRate = vc.commissionChange.commissionRate;
        v.detail.updateTimestamp = vc.commissionChange.updateTimestamp;
      }
    }

    if (dirty) {
      const { newAcitve, totalVotingPower } = this.sort();

      this.computeNewPriorities(newAcitve, totalVotingPower);

      // save
      this.active = newAcitve;
      this.totalVotingPower = totalVotingPower;
    }
  }

  isActive(validator: Address) {
    const index = this.active.findIndex(({ validator: v }) => v.equals(validator));
    return index !== -1;
  }

  async getActiveValidatorDetail(validator: Address, sm: StakeManager) {
    if (!this.isActive(validator)) {
      return undefined;
    }
    const v = this.validators.get(validator.buf);
    return v ? v.detail ?? (v.detail = await sm.validators(validator)) : await sm.validators(validator);
  }

  activeSigners() {
    return this.active.map(({ validator }) => validator);
  }

  copy(common: Common) {
    return ValidatorSet.createFromValidatorSet(this, common);
  }

  private _incrementProposerPriority() {
    for (const av of this.active) {
      const v = this.validators.get(av.validator.buf);
      if (v) {
        av.priority = av.priority.add(v.votingPower);
      }
    }

    // we don't choose and sub most priority in clique consensus
  }

  incrementProposerPriority(times: number) {
    const diffMax = this.totalVotingPower.muln(priorityWindowSizeFactor);
    this.rescalePriorities(diffMax);
    this.shiftByAvgProposerPriority();
    for (let i = 0; i < times; i++) {
      // TODO
      this._incrementProposerPriority();
    }
  }

  private calcPriorityDiff() {
    if (this.active.length === 0) {
      return new BN(0);
    }
    let max: BN | undefined;
    let min: BN | undefined;
    for (const av of this.active) {
      if (max === undefined || max.lt(av.priority)) {
        max = av.priority;
      }
      if (min === undefined || min.gt(av.priority)) {
        min = av.priority;
      }
    }
    return max!.sub(min!);
  }

  private calcAvgPriority() {
    const len = this.active.length;
    const sum = new BN(0);
    for (const av of this.active) {
      sum.iadd(av.priority);
    }
    return sum.divn(len);
  }

  private rescalePriorities(diffMax: BN) {
    const diff = this.calcPriorityDiff();
    if (diff.gt(diffMax)) {
      // ceil div
      const ratio = diff.add(diffMax).subn(1).div(diffMax);
      // rescale
      for (const av of this.active) {
        av.priority = av.priority.div(ratio);
      }
    }
  }

  private shiftByAvgProposerPriority() {
    const avg = this.calcAvgPriority();
    for (const av of this.active) {
      av.priority = av.priority.sub(avg);
    }
  }
}
