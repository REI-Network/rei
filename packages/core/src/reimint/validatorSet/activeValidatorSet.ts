import { Address, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { StakeManager, ValidatorBLS } from '../contracts';
import { IndexedValidator } from './indexedValidatorSet';
import {
  getGenesisValidators,
  genesisValidatorPriority,
  genesisValidatorVotingPower,
  isGenesis
} from './genesis';
import { isEnableBetterPOS } from '../../hardforks';
import { ActiveValidator as ActiveValidatorInfo } from '../contracts/stakeManager';
import { ValidatorChanges } from './validatorChanges';

const maxInt256 = new BN(
  '7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'hex'
);
const minInt256 = new BN(
  '8000000000000000000000000000000000000000000000000000000000000000',
  'hex'
).neg();
const maxProposerPriority = maxInt256;
const minProposerPriority = minInt256;

const priorityWindowSizeFactor = 2;

// active validator information
export type ActiveValidator = {
  // validator address
  validator: Address;
  // proposer priority
  priority: BN;
  // voting power
  votingPower: BN;
  // bls public key
  blsPublicKey?: Buffer;
};

// clone a `ActiveValidator`
export function copyActiveValidator(av: ActiveValidator) {
  return {
    ...av,
    priority: av.priority.clone(),
    votingPower: av.votingPower.clone()
  };
}

export class ActiveValidatorSet {
  // a sorted active validator list
  private active: ActiveValidator[];
  // current proposer address
  private _proposer: Address;
  // total voting power of active validator list
  private _totalVotingPower: BN;

  /**
   * Load active validator set from state trie
   * @param sm - Stake manager instance
   * @param bls - Bls contract instance
   * @returns ActiveValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager, bls?: ValidatorBLS) {
    // load proposer address
    const proposer = await sm.proposer();

    // according to different hard forks, load active validators
    const activeValidatorInfos: ActiveValidatorInfo[] = [];
    if (isEnableBetterPOS(sm.common)) {
      activeValidatorInfos.push(...(await sm.allActiveValidators()));
    } else {
      const length = await sm.activeValidatorsLength();
      for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
        activeValidatorInfos.push(await sm.activeValidators(i));
      }
    }

    const active: ActiveValidator[] = [];
    let genesis: boolean | undefined = undefined;
    for (const v of activeValidatorInfos) {
      // make sure the validator set is consistent
      const _genesis = isGenesis(v.validator, sm.common);
      if (genesis === undefined) {
        genesis = _genesis;
      } else if (genesis !== _genesis) {
        throw new Error(
          'invalid validator set, mix of genesis validators and common validators'
        );
      }

      // load voting power
      const votingPower = _genesis
        ? genesisValidatorVotingPower.clone()
        : await sm.getVotingPowerByAddress(v.validator);

      // load bls public key(if exists)
      let blsPublicKey: Buffer | undefined = undefined;
      if (bls) {
        blsPublicKey = await bls.getBLSPublicKey(v.validator);
      }

      active.push({
        ...v,
        votingPower,
        blsPublicKey
      });
    }

    return new ActiveValidatorSet(active, proposer);
  }

  /**
   * Create ActiveValidatorSet from active validator list
   * NOTE: the validator priority is 0
   * @param activeValidators - Active validator list
   * @returns ActiveValidatorSet instance
   */
  static fromActiveValidators(activeValidators: IndexedValidator[]) {
    const active = activeValidators.map((av) => {
      return {
        ...av,
        priority: new BN(0)
      };
    });
    return new ActiveValidatorSet(active);
  }

  /**
   * Create genesis validator set
   * @param common - Common instance
   * @param bls - Bls contract instance
   * @returns ActiveValidatorSet instance
   */
  static async genesis(common: Common, bls?: ValidatorBLS) {
    const active: ActiveValidator[] = [];
    for (const gv of getGenesisValidators(common)) {
      const av: ActiveValidator = {
        validator: gv,
        priority: genesisValidatorPriority.clone(),
        votingPower: genesisValidatorVotingPower.clone(),
        blsPublicKey: bls ? await bls.getBLSPublicKey(gv) : undefined
      };

      active.push(av);
    }
    return new ActiveValidatorSet(active);
  }

  constructor(active: ActiveValidator[], proposer?: Address) {
    this.active = active;
    this._proposer = proposer ?? this.calcProposer().validator;
    this._totalVotingPower = this.calcTotalVotingPower();
  }

  /**
   * Get active validator list length
   */
  get length() {
    return this.active.length;
  }

  /**
   * Get proposer address
   */
  get proposer() {
    return this._proposer;
  }

  /**
   * Get total active validator list voting power
   */
  get totalVotingPower() {
    return this._totalVotingPower.clone();
  }

  /**
   * Get active validator addresses
   * @returns List of active validator address
   */
  activeValidatorAddresses() {
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
   * Get validator index by address
   * @param address - Address
   * @returns Validator index
   */
  getIndexByAddress(address: Address) {
    const index = this.active.findIndex(({ validator }) =>
      validator.equals(address)
    );
    if (index === -1) {
      return undefined;
    }
    return index;
  }

  /**
   * Get validator address by index
   * @param index - Index
   * @returns Validator address
   */
  getValidatorByIndex(index: number) {
    if (index < 0 || index >= this.active.length) {
      throw new Error('validator index is out of range');
    }
    return this.active[index].validator;
  }

  /**
   * Get active validator voting power by address
   * @param validator - Address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    const av = this.active.find(({ validator: _validator }) =>
      _validator.equals(validator)
    );
    const vp = av?.votingPower;
    if (!vp) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return vp.clone();
  }

  /**
   * Get active validator bls public key by address
   * @param validator - Address
   * @returns Bls public key
   */
  getBlsPublicKey(validator: Address) {
    const av = this.active.find(({ validator: _validator }) =>
      _validator.equals(validator)
    );
    const pk = av?.blsPublicKey;
    if (!pk) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return pk;
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

    const av = this.calcProposer();
    av.priority.isub(this._totalVotingPower);
    this._proposer = av.validator;
  }

  /**
   * Calculate priority through parent set
   * @param parent - Parent active validator set
   */
  computeNewPriorities(parent?: ActiveValidatorSet) {
    const tvpAfterUpdatesBeforeRemovals = this._totalVotingPower.add(
      parent ? this.compareRemovals(parent) : new BN(0)
    );
    // - 1.25 * tvpAfterUpdatesBeforeRemovals
    const newPriority = tvpAfterUpdatesBeforeRemovals.muln(10).divn(8).neg();

    for (const av of this.active) {
      if (parent) {
        const index = parent.active.findIndex(({ validator }) =>
          validator.equals(av.validator)
        );
        if (index !== -1) {
          av.priority = parent.active[index].priority.clone();
        } else {
          av.priority = newPriority.clone();
        }
      } else {
        av.priority = newPriority.clone();
      }
    }

    this._proposer = this.calcProposer().validator;
  }

  /**
   * Merge validator set changes
   * @param activeValidators - Changes
   */
  merge(activeValidators: IndexedValidator[]) {
    this.active = activeValidators.map((av) => {
      return {
        ...av,
        priority: new BN(0)
      };
    });
    this._proposer = this.calcProposer().validator;
    this._totalVotingPower = this.calcTotalVotingPower();
  }

  /**
   * Copy a new set
   * @returns ActiveValidatorSet instance
   */
  copy() {
    return new ActiveValidatorSet(
      this.active.map(copyActiveValidator),
      this._proposer
    );
  }

  /**
   * Check validator is actived
   * @param validator - Validator address
   * @returns `true` if it is actived
   */
  isActive(validator: Address) {
    const index = this.active.findIndex(({ validator: _validator }) =>
      _validator.equals(validator)
    );
    return index !== -1;
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
      if (!this.isActive(gv)) {
        return false;
      }
      if (!this.getVotingPower(gv).eq(genesisValidatorVotingPower)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Update active bls public key according to validatorChanges
   * @param changes - Validator changes
   */
  reloadBlsPublicKey(changes: ValidatorChanges) {
    changes.blsValidators.forEach((pk, validator) => {
      for (const av of this.active) {
        if (av.validator.equals(validator)) {
          av.blsPublicKey = pk;
          break;
        }
      }
    });
  }

  // compute removed voting power
  private compareRemovals(parent: ActiveValidatorSet) {
    const removedVotingPower = new BN(0);
    const { active } = parent;
    for (const { validator, votingPower } of active) {
      if (
        this.active.filter(({ validator: _validator }) =>
          _validator.equals(validator)
        ).length === 0
      ) {
        removedVotingPower.iadd(votingPower);
      }
    }
    return removedVotingPower;
  }

  private calcProposer() {
    if (this.active.length === 0) {
      throw new Error('active validators list is empty');
    }
    let proposer: ActiveValidator | undefined;
    for (const av of this.active) {
      if (
        proposer === undefined ||
        proposer.priority.lt(av.priority) ||
        (proposer.priority.eq(av.priority) &&
          proposer.validator.buf.compare(av.validator.buf) === 1)
      ) {
        proposer = av;
      }
    }
    return proposer!;
  }

  private calcTotalVotingPower() {
    const totalVotingPower = new BN(0);
    for (const { votingPower: vp } of this.active) {
      totalVotingPower.iadd(vp);
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
