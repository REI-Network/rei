import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { createBufferFunctionalMap } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { StakeManager, ActiveValidator } from '../contracts';
import { ValidatorChanges } from './validatorChanges';

const maxInt256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const minInt256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();
const maxProposerPriority = maxInt256;
const minProposerPriority = minInt256;

const priorityWindowSizeFactor = 2;

const genesisValidatorVotingPower = new BN(1);
const genesisValidatorPriority = new BN(1);

// genesis validators
let genesisValidators: Address[] | undefined;

export function getGenesisValidators(common: Common) {
  // get genesis validators from common
  if (!genesisValidators) {
    genesisValidators = common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    // sort by address
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
  }
  return [...genesisValidators];
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

// sort all indexed validators, generate a list of active validator
function sort(common: Common, validators: Map<Buffer, ValidatorInfo>) {
  const maxCount = common.param('vm', 'maxValidatorsCount');

  // create a heap to keep the maximum count validator
  const heap = new Heap({
    compar: (a: ValidatorInfo, b: ValidatorInfo) => {
      let num = a.votingPower.cmp(b.votingPower);
      if (num === 0) {
        num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
        num *= -1;
      }
      return num;
    }
  });

  for (const v of validators.values()) {
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

  return newAcitve;
}

/**
 * Calculate proposer address
 * @returns Proposer address and priority
 */
function calcProposer(active: ActiveValidator[]) {
  if (active.length === 0) {
    throw new Error('active validators list is empty');
  }
  let proposer: ActiveValidator | undefined;
  for (const av of active) {
    if (proposer === undefined || proposer.priority.lt(av.priority) || (proposer.priority.eq(av.priority) && proposer!.validator.buf.compare(av.validator.buf) === 1)) {
      proposer = av;
    }
  }
  return proposer!;
}

// a class used to maintain validator set
export class ValidatorSet {
  // indexed validator set
  private readonly validators: Map<Buffer, ValidatorInfo>;
  // a sorted active validator list
  private active: ActiveValidator[];
  // common instance
  private _common: Common;
  // current proposer address
  private _proposer: Address;
  // total voting power of active validator list
  private _totalVotingPower: BN;

  constructor(validators: Map<Buffer, ValidatorInfo>, active: ActiveValidator[], proposer: Address, common: Common) {
    this.validators = validators;
    this.active = active;
    this._proposer = proposer;
    this._common = common;
    this._totalVotingPower = this.calcTotalVotingPower(active);
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

  get common() {
    return this._common;
  }

  /**
   * Create a validator set from `StakeManager`,
   * it will load indexed and active validator set from contract and exclude all genesis validators
   * @param sm - `StakeManager` instance
   * @param sortValidators - Sort validators or load directly from the contract
   * @returns New validator set
   */
  static async createFromStakeManager(sm: StakeManager, sortValidators = false) {
    const common = sm.common;
    const genesisValidators = getGenesisValidators(common);
    const isGenesis = (validator: Address) => {
      return genesisValidators.filter((gv) => gv.equals(validator)).length > 0;
    };

    const validators = createBufferFunctionalMap<ValidatorInfo>();
    let length = await sm.indexedValidatorsLength();
    for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      // exclude genesis validators
      if (isGenesis(validator)) {
        continue;
      }

      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        validators.set(validator.buf, {
          validator,
          votingPower
        });
      }
    }

    let proposer: Address;
    let active: ActiveValidator[];
    if (sortValidators) {
      active = sort(common, validators);
      proposer = calcProposer(active).validator;
    } else {
      proposer = await sm.proposer();
      active = [];
      length = await sm.activeValidatorsLength();
      for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
        const av = await sm.activeValidators(i);

        if (isGenesis(av.validator)) {
          throw new Error('invalid genesis validator');
        }

        active.push(av);
        // make sure every validator exists in the map
        if (!validators.has(av.validator.buf)) {
          throw new Error('unknown validator:' + av.validator.toString());
        }
      }
    }

    return new ValidatorSet(validators, active, proposer, common);
  }

  /**
   * Create a genesis validator set from `StakeManager`,
   * it will only load active validator set from contract
   * @param sm - `StakeManager` instance
   * @returns New validator set
   */
  static async createGenesisValidatorSetFromStakeManager(sm: StakeManager) {
    const common = sm.common;
    const validators = createBufferFunctionalMap<ValidatorInfo>();
    const active: ActiveValidator[] = [];

    const length = await sm.activeValidatorsLength();
    for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
      const av = await sm.activeValidators(i);
      active.push(av);
      // make sure every validator exists in the map
      if (!validators.has(av.validator.buf)) {
        validators.set(av.validator.buf, {
          validator: av.validator,
          votingPower: genesisValidatorVotingPower.clone()
        });
      }
    }

    // make sure it is a genesis validator set
    const set = new ValidatorSet(validators, active, await sm.proposer(), common);
    if (!set.isGenesisValidatorSet()) {
      throw new Error('invalid genesis validator set');
    }

    return set;
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @returns New validator set
   */
  static createGenesisValidatorSet(common: Common) {
    const validators = createBufferFunctionalMap<ValidatorInfo>();
    const active: ActiveValidator[] = [];
    for (const validator of getGenesisValidators(common)) {
      validators.set(validator.buf, {
        validator,
        votingPower: genesisValidatorVotingPower.clone()
      });
      active.push({
        validator,
        priority: genesisValidatorPriority.clone()
      });
    }
    return new ValidatorSet(validators, active, calcProposer(active).validator, common);
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
    }

    let flag = false;
    if (dirty) {
      const newAcitve = sort(this.common, this.validators);
      const newTotalVotingPower = this.calcTotalVotingPower(newAcitve);

      flag = this.compareActiveValidators(changes.parent, newAcitve, newTotalVotingPower);
      if (flag) {
        const removedVotingPower = this.compareRemovals(changes.parent, newAcitve);
        const tvpAfterUpdatesBeforeRemovals = newTotalVotingPower.add(removedVotingPower);
        this.computeNewPriorities(newAcitve, tvpAfterUpdatesBeforeRemovals);

        // update active validator list and total voting power
        this.active = newAcitve;
        this._totalVotingPower = newTotalVotingPower;
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
   * Check validator set is a genesis validator set,
   * the genesis validator set contains only the genesis validator
   * @returns `true` if it is
   */
  isGenesisValidatorSet() {
    const genesisValidators = getGenesisValidators(this._common);
    if (genesisValidators.length !== this.length) {
      return false;
    }
    for (const gv of genesisValidators) {
      if (!this.isActive(gv) || !this.contains(gv)) {
        return false;
      }
      if (!this.getVotingPower(gv).eq(genesisValidatorVotingPower)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get voting power by validator address
   * @param validator - Validator address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    const vp = this.validators.get(validator.buf)?.votingPower;
    if (!vp) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return vp.clone();
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
      return undefined;
    }
    return index;
  }

  /**
   * Check whether validator is indexed
   * @param validator - Validator address
   * @returns `true` if it is indexed
   */
  contains(validator: Address) {
    return this.validators.has(validator.buf);
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
    return new ValidatorSet(validators, this.active.map(cloneActiveValidator), this.proposer, this._common);
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

    const av = calcProposer(this.active);
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
