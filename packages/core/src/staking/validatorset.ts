import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { StakeManager, Validator, ActiveValidator } from '../contracts';
import { ValidatorChanges } from './validatorchanges';

const maxInt256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const minInt256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();
export const maxProposerPriority = maxInt256;
export const minProposerPriority = minInt256;

const priorityWindowSizeFactor = 2;
// genesis validators
let genesisValidators: Address[] | undefined;

// validator information
export type ValidatorInfo = {
  // validator address
  validator: Address;
  // voting power
  votingPower: BN;
  // validator detail information
  detail?: Validator;
};

// clone a `ValidatorInfo`
function cloneValidatorInfo(info: ValidatorInfo) {
  return {
    ...info,
    votingPower: info.votingPower.clone()
  };
}

// clone a `ActiveValidator`
function cloneActiveValidator(av: ActiveValidator) {
  return {
    ...av,
    priority: av.priority.clone()
  };
}

// fill the genesis validator into the active validator list when it is not full
function fillGenesisValidators(active: ActiveValidator[], maxCount: number, common: Common) {
  // get genesis validators from common
  if (!genesisValidators) {
    genesisValidators = common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    // sort by address
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
  }
  const gvs = [...genesisValidators];
  // the genesis validator sorted by address and has nothing to do with voting power
  while (gvs.length > 0 && active.length < maxCount) {
    const gv = gvs.shift()!;
    if (active.filter(({ validator }) => validator.equals(gv)).length === 0) {
      active.push({
        validator: gv,
        priority: new BN(0)
      });
    }
  }
}

// a class used to maintain validator set
export class ValidatorSet {
  // indexed validator set
  private validators = createBufferFunctionalMap<ValidatorInfo>();
  // a sorted active validator list
  private active: ActiveValidator[] = [];
  // total voting power of active validator list
  private totalVotingPower = new BN(0);
  // common instance
  private common: Common;
  // whether to fill genesis validator to active validator list when it is not full, default: `true`
  private fillGenesisValidators: boolean;

  constructor(common: Common, fillGenesisValidators: boolean = true) {
    this.common = common;
    this.fillGenesisValidators = fillGenesisValidators;
  }

  /**
   * Clone a validator set from another
   * @param parent - Another validator set
   * @param common - Common instance for new set
   * @returns New validator set
   */
  static createFromValidatorSet(parent: ValidatorSet, common: Common) {
    const vs = new ValidatorSet(common);
    for (const [validator, info] of parent.validators) {
      vs.validators.set(validator, cloneValidatorInfo(info));
    }
    vs.active = parent.active.map(cloneActiveValidator);
    return vs;
  }

  /**
   * Create a validator set from `StakeManager`,
   * it will load indexed and active validator set from contract
   * @param sm - `StakeManager` instance
   * @returns New validator set
   */
  static async createFromStakeManager(sm: StakeManager) {
    const vs = new ValidatorSet(sm.common);
    let length = await sm.indexedValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        vs.validators.set(validator.buf, {
          validator,
          votingPower
        });
      }
    }
    length = await sm.activeValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      vs.active.push(await sm.activeValidators(i));
    }
    return vs;
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @param _fillGenesisValidators - Fill genesis validators or not
   * @returns New validator set
   */
  static createGenesisValidatorSet(common: Common, _fillGenesisValidators: boolean = true) {
    const vs = new ValidatorSet(common, _fillGenesisValidators);
    if (_fillGenesisValidators) {
      fillGenesisValidators(vs.active, common.param('vm', 'maxValidatorsCount'), common);
    }
    return vs;
  }

  // sort all indexed validators
  private sort() {
    const maxCount = this.common.param('vm', 'maxValidatorsCount');
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      comparBefore: (a: ValidatorInfo, b: ValidatorInfo) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          num = (-1 * a.validator.buf.compare(b.validator.buf)) as 1 | -1 | 0;
        }
        return num === -1;
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
    if (this.fillGenesisValidators && newAcitve.length < maxCount) {
      fillGenesisValidators(newAcitve, maxCount, this.common);
    }

    return { newAcitve, totalVotingPower };
  }

  // compute priority for new active validator list
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

  // get validator object by address(create if it does not exist)
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

  // compare new active validator list with parent
  // return `true` if it is dirty
  private compareActiveValidators(parent: ValidatorSet, newAcitve: ActiveValidator[], totalVotingPower: BN) {
    if (!parent.totalVotingPower.eq(totalVotingPower) || parent.active.length !== newAcitve.length) {
      return true;
    }
    for (let i = 0; i < newAcitve.length; i++) {
      const { validator: pre } = parent.active[i];
      const { validator: curr } = newAcitve[i];
      if (curr.equals(pre) && this.getVotingPower(curr).eq(parent.getVotingPower(pre))) {
        // do nothing
      } else {
        return true;
      }
    }
    return false;
  }

  // compute removed voting power
  private compareRemovals(parent: ValidatorSet, newAcitve: ActiveValidator[]) {
    const removedVotingPower = new BN(0);
    for (const pav of parent.active) {
      if (newAcitve.filter(({ validator }) => validator.equals(pav.validator)).length === 0) {
        removedVotingPower.iadd(parent.getVotingPower(pav.validator));
      }
    }
    return removedVotingPower;
  }

  /**
   * Merge validator set changes
   * @param changes - `ValidatorChanges` instance
   */
  mergeChanges(changes: ValidatorChanges) {
    // TODO: if the changed validator is an active validator, the active list maybe not be dirty
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

    let flag = false;
    if (dirty) {
      const { newAcitve, totalVotingPower } = this.sort();

      flag = this.compareActiveValidators(changes.parent, newAcitve, totalVotingPower);
      if (flag) {
        const removedVotingPower = this.compareRemovals(changes.parent, newAcitve);
        const tvpAfterUpdatesBeforeRemovals = totalVotingPower.add(removedVotingPower);
        this.computeNewPriorities(newAcitve, tvpAfterUpdatesBeforeRemovals);

        // update active validator list and total voting power
        this.active = newAcitve;
        this.totalVotingPower = totalVotingPower;
      }
    }

    if (flag) {
      this.rescalePriorities(this.totalVotingPower.muln(priorityWindowSizeFactor));
      this.shiftByAvgProposerPriority();
    }
  }

  /**
   * Check validator is actived
   * @param validator - Validator address
   * @returns `true` if it is actived
   */
  isActive(validator: Address) {
    const index = this.active.findIndex(({ validator: v }) => v.equals(validator));
    return index !== -1;
  }

  /**
   * Get validator detail information
   * @param validator - Validator address
   * @param sm - `StakeManager` instance
   * @returns Detail information
   */
  async getActiveValidatorDetail(validator: Address, sm: StakeManager) {
    if (!this.isActive(validator)) {
      return undefined;
    }
    const v = this.validators.get(validator.buf);
    return v ? v.detail ?? (v.detail = await sm.validators(validator)) : await sm.validators(validator);
  }

  /**
   * Get voting power by validator address
   * @param validator - Validator address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    return this.validators.get(validator.buf)?.votingPower ?? new BN(0);
  }

  /**
   * Check whether validator is indexed
   * @param validator - Validator address
   * @returns `true` if it is indexed
   */
  contains(validator: Address) {
    return this.isActive(validator) || this.validators.has(validator.buf);
  }

  /**
   * Get active validator addresses
   * @returns List of active validator address
   */
  activeSigners() {
    return this.active.map(({ validator }) => validator);
  }

  /**
   * Get active validator list
   * @returns Active validator list
   */
  activeValidators() {
    return [...this.active];
  }

  /**
   * Copy a new validator set
   * @param common - Common instance for new set
   * @returns New validator set
   */
  copy(common: Common) {
    return ValidatorSet.createFromValidatorSet(this, common);
  }

  /**
   * Increase proposer priority
   * @param times - Increase times
   */
  incrementProposerPriority(times: number) {
    // in clique consensus, times must be 1
    if (times !== 1) {
      throw new Error('invalid times');
    }

    const diffMax = this.totalVotingPower.muln(priorityWindowSizeFactor);
    this.rescalePriorities(diffMax);
    this.shiftByAvgProposerPriority();
    for (let i = 0; i < times; i++) {
      this._incrementProposerPriority();
    }
  }

  /**
   * Substract proposer's priority
   * @param validator - Proposer address
   */
  subtractProposerPriority(validator: Address) {
    const av = this.active.find(({ validator: v }) => v.equals(validator));
    if (!av) {
      throw new Error("active validator doesn't exist");
    }
    av.priority.isub(this.totalVotingPower);
  }

  /**
   * Get current proposer address
   * @returns Proposer address
   */
  proposer() {
    if (this.active.length === 0) {
      throw new Error('active validators list is empty');
    }
    let max: BN | undefined;
    let proposer: Address | undefined;
    for (const av of this.active) {
      if (max === undefined || max.lt(av.priority) || (max.eq(av.priority) && proposer!.buf.compare(av.validator.buf) === 1)) {
        max = av.priority;
        proposer = av.validator;
      }
    }
    return proposer!;
  }

  private _incrementProposerPriority() {
    for (const av of this.active) {
      av.priority.iadd(this.getVotingPower(av.validator));
      if (av.priority.lt(minProposerPriority)) {
        throw new Error('proposer priority is too small');
      }
      if (av.priority.gt(maxProposerPriority)) {
        throw new Error('proposer priority is too high');
      }
    }

    // we don't choose and sub most priority in clique consensus,
    // proposer priority will be reduce in `subtractProposerPriority`
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
