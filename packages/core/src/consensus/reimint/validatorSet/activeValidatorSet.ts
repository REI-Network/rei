import { Address, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { StakeManager, ValidatorBls } from '../contracts';
import { IndexedValidator } from './indexedValidatorSet';
import { getGenesisValidators, genesisValidatorPriority, genesisValidatorVotingPower, isGenesis } from './genesis';
import { isEnableBetterPOS, isEnableDAO } from '../../../hardforks';
import { ActiveValidator as ActiveValidatorInfo } from '../contracts/stakeManager';

const maxInt256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const minInt256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();
const maxProposerPriority = maxInt256;
const minProposerPriority = minInt256;

const priorityWindowSizeFactor = 2;

// genesis validator bls infos
const genesisValidatorInfos = new Map<string, Map<string, string>>([
  [
    'rei-devnet',
    new Map<string, string>([
      ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xe4f75966f66de932f8588d7e43cebffa72b94959e7f2b25ab467528857f143fefd49e2321da1cd8d819e5ef4a4cd18a3'],
      ['0x809fae291f79c9953577ee9007342cff84014b1c', '0xb075545c9343c3c77b55c235c70498e3a778e650d3b41119135264d1f18af4c1b4d2d6652a86e74239a8e6c895dcffd4'],
      ['0x57b80007d142297bc383a741e4c1dd18e4c75754', '0xece169fa620dbe26eba06cf16d32eb9ce62b1b3f21208126ab27ee75f7d1a22e0a04f2c641f43440d28015c29a5f8b2c'],
      ['0x8d187ee877eeff8698de6808568fd9f1415c7f91', '0xd35c4584f50333fdf5568cfb56fbeaea8bbf470f43ddf348d2c87eb21d0904e3041e99b21a08365160e1b98888c6bd86'],
      ['0x5eb85b475068f7caa22b2758d58c4b100a418684', '0x126dc3438b328146495c41e4b325cc4ee18a0b792e0eb3942e5881ff5e190c4a5f922a0aed6193608da745a5ef9bebba']
    ])
  ],
  [
    'rei-testnet',
    new Map<string, string>([
      ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xe4f75966f66de932f8588d7e43cebffa72b94959e7f2b25ab467528857f143fefd49e2321da1cd8d819e5ef4a4cd18a3'],
      ['0x809fae291f79c9953577ee9007342cff84014b1c', '0xb075545c9343c3c77b55c235c70498e3a778e650d3b41119135264d1f18af4c1b4d2d6652a86e74239a8e6c895dcffd4'],
      ['0x57b80007d142297bc383a741e4c1dd18e4c75754', '0xece169fa620dbe26eba06cf16d32eb9ce62b1b3f21208126ab27ee75f7d1a22e0a04f2c641f43440d28015c29a5f8b2c'],
      ['0x8d187ee877eeff8698de6808568fd9f1415c7f91', '0xd35c4584f50333fdf5568cfb56fbeaea8bbf470f43ddf348d2c87eb21d0904e3041e99b21a08365160e1b98888c6bd86'],
      ['0x5eb85b475068f7caa22b2758d58c4b100a418684', '0x126dc3438b328146495c41e4b325cc4ee18a0b792e0eb3942e5881ff5e190c4a5f922a0aed6193608da745a5ef9bebba']
    ])
  ],
  [
    'rei-mainnet',
    new Map<string, string>([
      ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xe4f75966f66de932f8588d7e43cebffa72b94959e7f2b25ab467528857f143fefd49e2321da1cd8d819e5ef4a4cd18a3'],
      ['0x809fae291f79c9953577ee9007342cff84014b1c', '0xb075545c9343c3c77b55c235c70498e3a778e650d3b41119135264d1f18af4c1b4d2d6652a86e74239a8e6c895dcffd4'],
      ['0x57b80007d142297bc383a741e4c1dd18e4c75754', '0xece169fa620dbe26eba06cf16d32eb9ce62b1b3f21208126ab27ee75f7d1a22e0a04f2c641f43440d28015c29a5f8b2c'],
      ['0x8d187ee877eeff8698de6808568fd9f1415c7f91', '0xd35c4584f50333fdf5568cfb56fbeaea8bbf470f43ddf348d2c87eb21d0904e3041e99b21a08365160e1b98888c6bd86'],
      ['0x5eb85b475068f7caa22b2758d58c4b100a418684', '0x126dc3438b328146495c41e4b325cc4ee18a0b792e0eb3942e5881ff5e190c4a5f922a0aed6193608da745a5ef9bebba']
    ])
  ]
]);

export interface LoadOptions {
  // is it a genesis active validator set
  genesis?: boolean;
  // validator bls contract instance
  bls?: ValidatorBls;
}

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
   * @param options - ActiveValidatorSet load options
   * @returns ActiveValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager, options: LoadOptions) {
    const proposer = await sm.proposer();
    const active: ActiveValidator[] = [];
    const activeValidatorInfos: ActiveValidatorInfo[] = [];
    if (isEnableBetterPOS(sm.common)) {
      activeValidatorInfos.push(...(await sm.allActiveValidators()));
    } else {
      const length = await sm.activeValidatorsLength();
      for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
        activeValidatorInfos.push(await sm.activeValidators(i));
      }
    }

    for (const v of activeValidatorInfos) {
      active.push({
        ...v,
        votingPower: options.genesis
          ? (() => {
              if (!isGenesis(v.validator, sm.common)) {
                throw new Error('unknown validator: ' + v.toString());
              }
              return genesisValidatorVotingPower.clone();
            })()
          : await sm.getVotingPowerByAddress(v.validator),
        blsPublicKey: options.bls ? await options.bls.getBlsPublicKey(v.validator) : undefined
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
   * @returns ActiveValidatorSet instance
   */
  static genesis(common: Common) {
    const active: ActiveValidator[] = [];
    const blsFlag = isEnableDAO(common);

    for (const gv of getGenesisValidators(common)) {
      const ac = {
        validator: gv,
        priority: genesisValidatorPriority.clone(),
        votingPower: genesisValidatorVotingPower.clone(),
        blsPublicKey: undefined
      } as ActiveValidator;

      if (blsFlag) {
        const blsPublicKey = genesisValidatorInfos.get(common.chainName())?.get(gv.toString());
        if (!blsPublicKey) {
          throw new Error(`genesis BLS public key of ${gv.toString()} is not found`);
        }
        ac.blsPublicKey = Buffer.from(blsPublicKey);
      }

      active.push(ac);
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
    const index = this.active.findIndex(({ validator }) => validator.equals(address));
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
    const av = this.active.find(({ validator: _validator }) => _validator.equals(validator));
    const vp = av?.votingPower;
    if (!vp) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return vp.clone();
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
    const tvpAfterUpdatesBeforeRemovals = this._totalVotingPower.add(parent ? this.compareRemovals(parent) : new BN(0));
    // - 1.25 * tvpAfterUpdatesBeforeRemovals
    const newPriority = tvpAfterUpdatesBeforeRemovals.muln(10).divn(8).neg();

    for (const av of this.active) {
      if (parent) {
        const index = parent.active.findIndex(({ validator }) => validator.equals(av.validator));
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
    return new ActiveValidatorSet(this.active.map(copyActiveValidator), this._proposer);
  }

  /**
   * Check validator is actived
   * @param validator - Validator address
   * @returns `true` if it is actived
   */
  isActive(validator: Address) {
    const index = this.active.findIndex(({ validator: _validator }) => _validator.equals(validator));
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

  // compute removed voting power
  private compareRemovals(parent: ActiveValidatorSet) {
    const removedVotingPower = new BN(0);
    const { active } = parent;
    for (const { validator, votingPower } of active) {
      if (this.active.filter(({ validator: _validator }) => _validator.equals(validator)).length === 0) {
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
      if (proposer === undefined || proposer.priority.lt(av.priority) || (proposer.priority.eq(av.priority) && proposer.validator.buf.compare(av.validator.buf) === 1)) {
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
