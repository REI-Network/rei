import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { StakeManager, ActiveValidator } from '../contracts';
import { ValidatorChanges } from './validatorchanges';

const maxInt256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const minInt256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();
export const maxProposerPriority = maxInt256;
export const minProposerPriority = minInt256;

const priorityWindowSizeFactor = 2;
// genesis validators
let genesisValidators: Address[] | undefined;

function getGenesisValidators(common: Common) {
  // get genesis validators from common
  if (!genesisValidators) {
    genesisValidators = common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    // sort by address
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
  }
  return [...genesisValidators];
}

// get append genesis validator when the validator set is not full
function getAppendGenesisValidators(contains: (address: Address) => boolean, currentCount: number, maxCount: number, gvs: Address[]) {
  const append: Address[] = [];
  while (gvs.length > 0 && currentCount < maxCount) {
    const gv = gvs.shift()!;
    if (!contains(gv)) {
      append.push(gv);
      currentCount++;
    }
  }
  return append;
}

// validator information
export type ValidatorInfo = {
  // validator address
  validator: Address;
  // voting power
  votingPower: BN;
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

// a class used to maintain validator set
export class ValidatorSet {
  // indexed validator set
  private readonly validators: Map<Buffer, ValidatorInfo>;
  // a sorted active validator list
  private active: ActiveValidator[];
  // common instance
  private common: Common;
  // whether to fill genesis validator to active validator list when it is not full, default: `true`
  private fillGenesisValidators: boolean;
  // current proposer address
  private _proposer: Address;
  // total voting power of active validator list
  private _totalVotingPower: BN;

  constructor(validators: Map<Buffer, ValidatorInfo>, active: ActiveValidator[], common: Common, fillGenesisValidators: boolean = true, totalVotingPower?: BN) {
    this.validators = validators;
    this.active = active;
    this.common = common;
    this.fillGenesisValidators = fillGenesisValidators;
    if (active.length > 0) {
      this._proposer = this.calcPreviousProposer().validator;
      this._totalVotingPower = totalVotingPower ?? this.calcTotalVotingPower(active);
    } else {
      this._proposer = Address.zero();
      this._totalVotingPower = new BN(0);
    }
  }

  get proposer() {
    return this._proposer;
  }

  get totalVotingPower() {
    return this._totalVotingPower.clone();
  }

  get length() {
    return this.active.length;
  }

  /**
   * Create a validator set from `StakeManager`,
   * it will load indexed and active validator set from contract
   * @param sm - `StakeManager` instance
   * @param fillGenesisValidators - Fill genesis validators or not
   * @returns New validator set
   */
  static async createFromStakeManager(sm: StakeManager, fillGenesisValidators: boolean = true) {
    const validators = createBufferFunctionalMap<ValidatorInfo>();
    let length = await sm.indexedValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        validators.set(validator.buf, {
          validator,
          votingPower
        });
      }
    }
    const active: ActiveValidator[] = [];
    length = await sm.activeValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      const av = await sm.activeValidators(i);
      active.push(av);
      // make sure every validator exists in the map
      if (!validators.has(av.validator.buf)) {
        validators.set(av.validator.buf, {
          validator: av.validator,
          votingPower: await sm.getVotingPowerByAddress(av.validator)
        });
      }
    }
    return new ValidatorSet(validators, active, sm.common, fillGenesisValidators);
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @param fillGenesisValidators - Fill genesis validators or not
   * @returns New validator set
   */
  static createGenesisValidatorSet(common: Common, fillGenesisValidators: boolean = true) {
    const validators = createBufferFunctionalMap<ValidatorInfo>();
    const active: ActiveValidator[] = [];
    if (fillGenesisValidators) {
      const append = getAppendGenesisValidators(() => false, 0, common.param('vm', 'maxValidatorsCount'), getGenesisValidators(common));
      for (const validator of append) {
        validators.set(validator.buf, {
          validator,
          votingPower: new BN(0)
        });
        active.push({
          validator,
          priority: new BN(0)
        });
      }
    }
    return new ValidatorSet(validators, active, common, fillGenesisValidators);
  }

  // sort all indexed validators
  private sort() {
    const maxCount = this.common.param('vm', 'maxValidatorsCount');
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      comparBefore: (a: ValidatorInfo, b: ValidatorInfo) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          // num = (-1 * a.validator.buf.compare(b.validator.buf)) as 1 | -1 | 0;
          num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
        }
        return num === -1;
      }
    });
    for (const v of this.validators.values()) {
      heap.push(v);
      // if the heap length is too large, remove the minimum one
      while (heap.length > maxCount) {
        heap.remove();
      }
    }

    // sort validators
    const newAcitve: ActiveValidator[] = [];
    while (heap.length > 0) {
      const v = heap.remove() as ValidatorInfo;
      newAcitve.unshift({
        validator: v.validator,
        priority: new BN(0)
      });
    }

    // fill genesis validators
    if (newAcitve.length < maxCount && this.fillGenesisValidators) {
      const append = getAppendGenesisValidators(
        (address: Address) => {
          return newAcitve.filter((av) => av.validator.equals(address)).length > 0;
        },
        newAcitve.length,
        maxCount,
        getGenesisValidators(this.common)
      );
      for (const validator of append) {
        newAcitve.push({
          validator,
          priority: new BN(0)
        });
      }
    }

    return { newAcitve, totalVotingPower: this.calcTotalVotingPower(newAcitve) };
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
    if (!parent._totalVotingPower.eq(totalVotingPower) || parent.active.length !== newAcitve.length) {
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
  async mergeChanges(changes: ValidatorChanges, sm?: StakeManager) {
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
    }

    // TODO: improve this logic
    // make sure genesis validator exists in the map
    if (this.fillGenesisValidators) {
      for (const gv of getGenesisValidators(this.common)) {
        const origin = this.validators.get(gv.buf);
        const currentVotingPower = await sm!.getVotingPowerByAddress(gv);
        if ((origin !== undefined && !origin.votingPower.eq(currentVotingPower)) || origin === undefined) {
          dirty = true;
          this.validators.set(gv.buf, {
            validator: gv,
            votingPower: currentVotingPower
          });
        }
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
        this._totalVotingPower = totalVotingPower;
      }
    }

    if (flag) {
      this.rescalePriorities(this._totalVotingPower.muln(priorityWindowSizeFactor));
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
   * Get voting power by validator address
   * @param validator - Validator address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    const vp = this.validators.get(validator.buf)?.votingPower;
    if (vp) {
      return vp.clone();
    }
    throw new Error('unknown validator, ' + validator.toString());
  }

  getValidatorByIndex(index: number) {
    if (index < 0 || index >= this.active.length) {
      throw new Error('validator index is out of range');
    }
    return this.active[index].validator;
  }

  getIndexByAddress(address: Address) {
    const index = this.active.findIndex(({ validator }) => validator.equals(address));
    if (index === -1) {
      throw new Error('invalid validator');
    }
    return index;
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
   * @returns New validator set
   */
  copy() {
    const validators = createBufferFunctionalMap<ValidatorInfo>();
    for (const [validator, info] of this.validators) {
      validators.set(validator, cloneValidatorInfo(info));
    }
    return new ValidatorSet(validators, this.active.map(cloneActiveValidator), this.common, this.fillGenesisValidators, this.totalVotingPower);
  }

  /**
   * Increase proposer priority
   * @param times - Increase times
   */
  incrementProposerPriority(times: number) {
    const diffMax = this._totalVotingPower.muln(priorityWindowSizeFactor);
    this.rescalePriorities(diffMax);
    this.shiftByAvgProposerPriority();
    for (let i = 0; i < times; i++) {
      this._incrementProposerPriority();
    }
  }

  private calcPreviousProposer() {
    if (this.active.length === 0) {
      throw new Error('active validators list is empty');
    }
    let previousProposer: ActiveValidator | undefined;
    for (const av of this.active) {
      if (previousProposer === undefined || previousProposer.priority.gt(av.priority) || (previousProposer.priority.eq(av.priority) && previousProposer!.validator.buf.compare(av.validator.buf) === -1)) {
        previousProposer = av;
      }
    }
    return previousProposer!;
  }

  /**
   * Calculate proposer address
   * @returns Proposer address and priority
   */
  private calcProposer() {
    if (this.active.length === 0) {
      throw new Error('active validators list is empty');
    }
    let proposer: ActiveValidator | undefined;
    for (const av of this.active) {
      if (proposer === undefined || proposer.priority.lt(av.priority) || (proposer.priority.eq(av.priority) && proposer!.validator.buf.compare(av.validator.buf) === 1)) {
        proposer = av;
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

    const av = this.calcProposer();
    av.priority.isub(this._totalVotingPower);
    this._proposer = av.validator;
  }

  private calcTotalVotingPower(active: ActiveValidator[]) {
    const totalVotingPower = new BN(0);
    for (const { validator } of active) {
      totalVotingPower.iadd(this.getVotingPower(validator));
    }
    return totalVotingPower;
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
