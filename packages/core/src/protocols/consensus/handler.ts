import { rlp, BN, bnToUnpaddedBuffer, intToBuffer } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { NewRoundStepMessage, NewValidBlockMessage, HasVoteMessage, Proposal, Vote, ProposalPOLMessage, VoteSetMaj23Message, VoteSetBitsMessage, GetProposalBlockMessage, ProposalBlockMessage, BitArray } from '../../consensus/reimint';
import { HandlerBase, HandlerFunc, HandlerBaseOptions } from '../handlerBase';
import { ConsensusProtocol } from './protocol';

const consensusHandlerFuncs: HandlerFunc[] = [
  {
    name: 'NewRoundStep',
    code: 0,
    encode(this: ConsensusProtocolHander, data: NewRoundStepMessage) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.step), intToBuffer(data.secondsSinceStartTime), intToBuffer(data.lastCommitRound)];
    },
    decode(this: ConsensusProtocolHander, data: any): NewRoundStepMessage {
      if (!Array.isArray(data) || data.length !== 5) {
        throw new Error('invalid values length');
      }
      const [height, round, step, secondsSinceStartTime, lastCommitRound] = data;
      return new NewRoundStepMessage(new BN(height), round, step, secondsSinceStartTime, lastCommitRound);
    }
  },
  {
    name: 'NewValidBlock',
    code: 1,
    encode(this: ConsensusProtocolHander, data: NewValidBlockMessage) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), data.hash, intToBuffer(data.isCommit ? 1 : 0)];
    },
    decode(this: ConsensusProtocolHander, data: any): NewValidBlockMessage {
      if (!Array.isArray(data) || data.length !== 4) {
        throw new Error('invalid values length');
      }
      const [height, round, hash, isCommit] = data;
      return new NewValidBlockMessage(new BN(height), round, hash, isCommit === 1);
    }
  },
  {
    name: 'HasVote',
    code: 2,
    encode(this: ConsensusProtocolHander, data: HasVoteMessage) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type), intToBuffer(data.index)];
    },
    decode(this: ConsensusProtocolHander, data: any): HasVoteMessage {
      if (!Array.isArray(data) || data.length !== 4) {
        throw new Error('invalid values length');
      }
      const [height, round, type, index] = data;
      return new HasVoteMessage(new BN(height), round, type, index);
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
    encode(this: ConsensusProtocolHander, data: ProposalPOLMessage) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.proposalPOLRound), data.proposalPOL.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): ProposalPOLMessage {
      if (!Array.isArray(data) || data.length !== 3) {
        throw new Error('invalid values length');
      }
      const [height, proposalPOLRound, proposalPOL] = data;
      if (!Array.isArray(proposalPOL) || proposalPOL.length !== 2) {
        throw new Error('invalid proposalPOL values length');
      }
      return new ProposalPOLMessage(new BN(height), proposalPOLRound, BitArray.fromValuesArray(proposalPOL as [number, number[]]));
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
    encode(this: ConsensusProtocolHander, data: VoteSetMaj23Message) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type), data.hash];
    },
    decode(this: ConsensusProtocolHander, data: any): VoteSetMaj23Message {
      if (!Array.isArray(data) || data.length !== 4) {
        throw new Error('invalid values length');
      }
      const [height, round, type, hash] = data;
      return new VoteSetMaj23Message(new BN(height), round, type, hash);
    }
  },
  {
    name: 'VoteSetBits',
    code: 7,
    encode(this: ConsensusProtocolHander, data: VoteSetBitsMessage) {
      return [bnToUnpaddedBuffer(data.height), intToBuffer(data.round), intToBuffer(data.type), data.hash, data.votes.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): VoteSetBitsMessage {
      if (!Array.isArray(data) || data.length !== 5) {
        throw new Error('invalid values');
      }
      const [height, round, type, hash, votes] = data;
      if (!Array.isArray(votes) || votes.length !== 2) {
        throw new Error('invalid votes values length');
      }
      return new VoteSetBitsMessage(new BN(height), round, type, hash, BitArray.fromValuesArray(votes as [number, number[]]));
    }
  },
  {
    name: 'GetProposalBlock',
    code: 8,
    encode(this: ConsensusProtocolHander, data: GetProposalBlockMessage) {
      return [data.hash];
    },
    decode(this: ConsensusProtocolHander, data: any): GetProposalBlockMessage {
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('invalid values length');
      }
      return new GetProposalBlockMessage(data[0]);
    }
  },
  {
    name: 'ProposalBlock',
    code: 9,
    encode(this: ConsensusProtocolHander, data: ProposalBlockMessage) {
      return [data.block.raw()];
    },
    decode(this: ConsensusProtocolHander, data: any): ProposalBlockMessage {
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('invalid values length');
      }
      return new ProposalBlockMessage(Block.fromValuesArray(data[0], { common: this.node.getCommon(0), hardforkByBlockNumber: true }));
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
    const handler = this.findHandler(method);
    return rlp.encode([handler.code, handler.encode.call(this, data)]);
  }
  protected decode(data: Buffer) {
    return rlp.decode(data) as unknown as [number, any];
  }

  constructor(options: ConsensusProtocolHanderOptions) {
    super({ ...options, handlerFuncs: consensusHandlerFuncs });
  }
}
