import { rlp, BN, bnToUnpaddedBuffer, intToBuffer } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { HandlerBase, HandlerFunc, HandlerBaseOptions } from '../handlerBase';
import { ConsensusProtocol } from './protocol';

//////////////////// types ////////////////////
import { Proposal } from '../../consensus/reimint/state';
import { BitArray, VoteType, Vote } from '../../consensus/reimint/types';

type NewRoundStepMsg = {
  height: BN;
  round: number;
  step: number;
  secondsSinceStartTime: number;
  lastCommitRound: number;
};

type NewValidBlockMsg = {
  height: BN;
  round: number;
  hash: Buffer;
  isCommit: boolean;
};

type HasVoteMsg = {
  height: BN;
  round: number;
  type: VoteType;
  index: number;
};

type ProposalPOLMsg = {
  height: BN;
  proposalPOLRound: number;
  proposalPOL: BitArray;
};

type VoteSetMaj23Msg = {
  height: BN;
  round: number;
  type: VoteType;
};

type VoteSetBitsMsg = {
  height: BN;
  round: number;
  type: VoteType;
  hash: Buffer;
  votes: BitArray;
};

type GetProposalBlockMsg = {
  hash: Buffer;
};

type ProposalBlockMsg = {
  block: Block;
};
//////////////////// types ////////////////////

const consensusHandlerFuncs: HandlerFunc[] = [
  {
    name: 'NewRoundStep',
    code: 0,
    encode(this: ConsensusProtocolHander, data: NewRoundStepMsg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.step), intToBuffer(data.secondsSinceStartTime), intToBuffer(data.lastCommitRound)];
    },
    decode(this: ConsensusProtocolHander, data: any): NewRoundStepMsg {
      if (!Array.isArray(data) || data.length !== 5) {
        throw new Error('invalid values length');
      }
      const [height, round, step, secondsSinceStartTime, lastCommitRound] = data;
      return {
        height: new BN(height),
        round,
        step,
        secondsSinceStartTime,
        lastCommitRound
      };
    }
  },
  {
    name: 'NewValidBlock',
    code: 1,
    encode(this: ConsensusProtocolHander, data: NewValidBlockMsg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), data.hash, intToBuffer(data.isCommit ? 1 : 0)];
    },
    decode(this: ConsensusProtocolHander, data: any): NewValidBlockMsg {
      if (!Array.isArray(data) || data.length !== 4) {
        throw new Error('invalid values length');
      }
      const [height, round, hash, isCommit] = data;
      return {
        height: new BN(height),
        round,
        hash,
        isCommit: isCommit === 1
      };
    }
  },
  {
    name: 'HasVote',
    code: 2,
    encode(this: ConsensusProtocolHander, data: HasVoteMsg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type), intToBuffer(data.index)];
    },
    decode(this: ConsensusProtocolHander, data: any) {
      if (!Array.isArray(data) || data.length !== 4) {
        throw new Error('invalid values length');
      }
      const [height, round, type, index] = data;
      return {
        height: new BN(height),
        round,
        type,
        index
      };
    }
  },
  {
    name: 'Proposal',
    code: 3,
    encode(this: ConsensusProtocolHander, data: Proposal) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): Proposal {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return Proposal.fromValuesArray(data as any);
    }
  },
  {
    name: 'ProposalPOL',
    code: 4,
    encode(this: ConsensusProtocolHander, data: ProposalPOLMsg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.proposalPOLRound), data.proposalPOL.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): ProposalPOLMsg {
      if (!Array.isArray(data) || data.length !== 3) {
        throw new Error('invalid values length');
      }
      const [height, proposalPOLRound, proposalPOL] = data;
      return {
        height: new BN(height),
        proposalPOLRound,
        proposalPOL: BitArray.fromValuesArray(proposalPOL)
      };
    }
  },
  {
    name: 'Vote',
    code: 5,
    encode(this: ConsensusProtocolHander, data: Vote) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): Vote {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return Vote.fromValuesArray(data as any);
    }
  },
  {
    name: 'VoteSetMaj23',
    code: 6,
    encode(this: ConsensusProtocolHander, data: VoteSetMaj23Msg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type)];
    },
    decode(this: ConsensusProtocolHander, data: any): VoteSetMaj23Msg {
      if (!Array.isArray(data) || data.length !== 3) {
        throw new Error('invalid values length');
      }
      const [height, round, type] = data;
      return {
        height: new BN(height),
        round,
        type
      };
    }
  },
  {
    name: 'VoteSetBits',
    code: 7,
    encode(this: ConsensusProtocolHander, data: VoteSetBitsMsg) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type), data.hash, data.votes.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): VoteSetBitsMsg {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      const [height, round, type, hash, votes] = data;
      return {
        height: new BN(height),
        round,
        type,
        hash,
        votes: BitArray.fromValuesArray(votes)
      };
    }
  },
  {
    name: 'GetProposalBlock',
    code: 8,
    encode(this: ConsensusProtocolHander, data: GetProposalBlockMsg) {
      return [data.hash];
    },
    decode(this: ConsensusProtocolHander, data: any): GetProposalBlockMsg {
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('invalid values length');
      }
      return {
        hash: data[0]
      };
    }
  },
  {
    name: 'ProposalBlock',
    code: 9,
    encode(this: ConsensusProtocolHander, data: ProposalBlockMsg) {
      return [data.block.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): ProposalBlockMsg {
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('invalid values length');
      }
      return {
        block: Block.fromValuesArray(data[0], { common: this.node.getCommon(0), hardforkByBlockNumber: true })
      };
    }
  }
];

export interface ConsensusProtocolHanderOptions extends Omit<HandlerBaseOptions, 'handlerFuncs'> {}

export class ConsensusProtocolHander extends HandlerBase<any> {
  protected onHandshakeSucceed() {
    ConsensusProtocol.getPool().add(this);
  }
  protected onHandshake() {}
  protected onHandshakeResponse(status: any) {
    return true;
  }
  protected onAbort() {
    ConsensusProtocol.getPool().remove(this);
  }

  protected encode(method: string | number, data: any) {
    return rlp.encode(this.findHandler(method).encode.call(this, data));
  }
  protected decode(data: Buffer) {
    return rlp.decode(data) as unknown as [number, any];
  }

  constructor(options: ConsensusProtocolHanderOptions) {
    super({ ...options, handlerFuncs: consensusHandlerFuncs });
  }
}
