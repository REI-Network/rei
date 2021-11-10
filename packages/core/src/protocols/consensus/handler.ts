import { rlp, BN } from 'ethereumjs-util';
import { logger } from '@gxchain2/utils';
import { ReimintConsensusEngine } from '../../consensus/reimint/reimintConsensusEngine';
import { RoundStepType, Proposal, BitArray, VoteType, VoteSet, MessageFactory } from '../../consensus/reimint/types';
import * as m from '../../consensus/reimint/types/messages';
import { BaseHandler } from '../baseHandler';
import { HandlerFunc, BaseHandlerOptions } from '../types';
import { ConsensusProtocol } from './protocol';

const peerGossipSleepDuration = 100;

const defaultNewRoundStepMessage = new m.NewRoundStepMessage(new BN(0), 0, RoundStepType.NewHeight);

const consensusHandlerFuncs: HandlerFunc[] = [
  {
    name: 'NewRoundStep',
    code: 0,
    encode(this: ConsensusProtocolHander, data: m.NewRoundStepMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.NewRoundStepMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values length');
      }
      return m.NewRoundStepMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.NewRoundStepMessage) {
      this.handshakeResponse(msg);
      this.applyNewRoundStepMessage(msg);
    }
  },
  {
    name: 'NewValidBlock',
    code: 1,
    encode(this: ConsensusProtocolHander, data: m.NewValidBlockMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.NewValidBlockMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values length');
      }
      return m.NewValidBlockMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.NewValidBlockMessage) {
      this.applyNewValidBlockMessage(msg);
    }
  },
  {
    name: 'HasVote',
    code: 2,
    encode(this: ConsensusProtocolHander, data: m.HasVoteMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.HasVoteMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values length');
      }
      return m.HasVoteMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.HasVoteMessage) {
      this.applyHasVoteMessage(msg);
    }
  },
  {
    name: 'Proposal',
    code: 3,
    encode(this: ConsensusProtocolHander, data: m.ProposalMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.ProposalMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.ProposalMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.ProposalMessage) {
      this.setHasProposal(msg.proposal);
      this.reimint?.state.newMessage(this.peer.peerId, msg);
    }
  },
  {
    name: 'ProposalPOL',
    code: 4,
    encode(this: ConsensusProtocolHander, data: m.ProposalPOLMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.ProposalPOLMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.ProposalPOLMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.ProposalPOLMessage) {
      this.applyProposalPOLMessage(msg);
    }
  },
  {
    name: 'Vote',
    code: 5,
    encode(this: ConsensusProtocolHander, data: m.VoteMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.VoteMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.VoteMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.VoteMessage) {
      if (this.reimint) {
        const vote = msg.vote;
        this.ensureVoteBitArrays(vote.height, this.reimint.state.getValSetSize());
        this.setHasVote(vote.height, vote.round, vote.type, vote.index);
        this.reimint.state.newMessage(this.peer.peerId, msg);
      }
    }
  },
  {
    name: 'VoteSetMaj23',
    code: 6,
    encode(this: ConsensusProtocolHander, data: m.VoteSetMaj23Message) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.VoteSetMaj23Message {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.VoteSetMaj23Message.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.VoteSetMaj23Message) {
      if (this.reimint) {
        this.reimint.state.setVoteMaj23(msg.height, msg.round, msg.type, this.peer.peerId, msg.hash);
        const voteSetBitsMessage = this.reimint.state.genVoteSetBitsMessage(msg.height, msg.round, msg.type, msg.hash);
        voteSetBitsMessage && this.sendMessage(voteSetBitsMessage);
      }
    }
  },
  {
    name: 'VoteSetBits',
    code: 7,
    encode(this: ConsensusProtocolHander, data: m.VoteSetBitsMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.VoteSetBitsMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.VoteSetBitsMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, msg: m.VoteSetBitsMessage) {
      this.applyVoteSetBitsMessage(msg);
    }
  },
  {
    name: 'GetProposalBlock',
    code: 8,
    encode(this: ConsensusProtocolHander, data: m.GetProposalBlockMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.GetProposalBlockMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.GetProposalBlockMessage.fromValuesArray(data);
    },
    process(this: ConsensusProtocolHander, { hash }: m.GetProposalBlockMessage) {
      const proposalBlock = this.node.getReimintEngine()?.state.getProposalBlock(hash);
      proposalBlock && this.sendMessage(new m.ProposalBlockMessage(proposalBlock));
    }
  },
  {
    name: 'ProposalBlock',
    code: 9,
    encode(this: ConsensusProtocolHander, data: m.ProposalBlockMessage) {
      return data.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): m.ProposalBlockMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return m.ProposalBlockMessage.fromValuesArray(data as any, { common: this.node.getCommon(0), hardforkByBlockNumber: true });
    },
    process(this: ConsensusProtocolHander, msg: m.ProposalBlockMessage) {
      this.reimint?.state.newMessage(this.peer.peerId, msg);
    }
  }
];

export interface ConsensusProtocolHanderOptions extends Omit<BaseHandlerOptions<ConsensusProtocol>, 'handlerFuncs'> {}

export class ConsensusProtocolHander extends BaseHandler<ConsensusProtocol> {
  readonly reimint?: ReimintConsensusEngine;
  private aborted: boolean = false;

  /////////////// PeerRoundState ///////////////
  private height: BN = new BN(0);
  private round: number = -1;
  private step: RoundStepType = RoundStepType.NewHeight;

  private proposal: boolean = false;
  private proposalBlockHash?: Buffer;
  private proposalPOLRound: number = -1;

  private proposalPOL?: BitArray;
  private prevotes?: BitArray;
  private precommits?: BitArray;

  private catchupCommitRound: number = -1;
  private catchupCommit?: BitArray;
  /////////////// PeerRoundState ///////////////

  protected onHandshakeSucceed() {
    this.protocol.addHandler(this);
  }
  protected onHandshake() {
    this.send(0, this.reimint?.state.genNewRoundStepMessage() ?? defaultNewRoundStepMessage);
  }
  protected onHandshakeResponse(roundStep: any) {
    if (!(roundStep instanceof m.NewRoundStepMessage)) {
      return false;
    }
    return true;
  }
  protected onAbort() {
    this.aborted = true;
    this.reimint?.off('start', this.onEngineStart);
    this.protocol.removeHandler(this);
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

    this.reimint = this.node.getReimintEngine();
    if (!this.reimint) {
      return;
    } else if (this.reimint.isStarted) {
      this.onEngineStart();
    } else {
      this.reimint.on('start', this.onEngineStart);
    }
  }

  private onEngineStart = () => {
    this.gossipDataLoop(this.reimint!);
    this.gossipVotesLoop(this.reimint!);
  };

  private async gossipDataLoop(reimint: ReimintConsensusEngine) {
    // if hand shake failed, break the loop
    if (!(await this.handshakePromise)) {
      return;
    }

    while (!this.aborted) {
      try {
        if (!this.proposal) {
          const proposalMessage = reimint.state.genProposalMessage(this.height, this.round);
          if (proposalMessage) {
            // logger.debug('ConsensusProtocolHander::gossipDataLoop, send proposal to:', this.peer.peerId);
            this.sendMessage(proposalMessage);
            this.setHasProposal(proposalMessage.proposal);
          }
        }
      } catch (err) {
        logger.error('ConsensusProtocolHander::gossipDataLoop, catch error:', err);
      }

      await new Promise((r) => setTimeout(r, peerGossipSleepDuration));
    }
  }

  private async gossipVotesLoop(reimint: ReimintConsensusEngine) {
    // if hand shake failed, break the loop
    if (!(await this.handshakePromise)) {
      return;
    }

    while (!this.aborted) {
      try {
        // pick vote from memory and send
        const votes = reimint.state.pickVoteSetToSend(this.height, this.round, this.proposalPOLRound, this.step);
        if (votes && this.pickAndSend(votes)) {
          continue;
        }
      } catch (err) {
        logger.error('ConsensusProtocolHander::gossipVotesLoop, catch error:', err);
      }

      await new Promise((r) => setTimeout(r, peerGossipSleepDuration));
    }
  }

  private pickRandom(votes: VoteSet) {
    if (votes.voteCount() === 0) {
      return;
    }

    const { height, round, signedMsgType } = votes;
    const valSetSize = votes.valSet.length;

    if (votes.isCommit()) {
      this.ensureCatchupCommitRound(height, round, valSetSize);
    }
    this.ensureVoteBitArrays(height, valSetSize);

    const remotePeerVotes = this.getVoteBitArray(height, round, signedMsgType);
    if (!remotePeerVotes) {
      return;
    }

    const index = votes.votesBitArray.sub(remotePeerVotes).pickRandom();
    if (index !== undefined) {
      return votes.getVoteByIndex(index);
    }
  }

  private pickAndSend(votes: VoteSet) {
    const vote = this.pickRandom(votes);
    if (vote) {
      // logger.debug('ConsensusProtocolHander::gossipDataLoop, send vote(h,r,h,t):', vote.height.toString(), vote.round, bufferToHex(vote.hash), vote.type, 'to:', this.peer.peerId);
      this.sendMessage(new m.VoteMessage(vote));
      this.setHasVote(vote.height, vote.round, vote.type, vote.index);
      return true;
    }
    return false;
  }

  sendMessage(msg: m.Message) {
    this.send(MessageFactory.registry.getCodeByInstance(msg), msg);
  }

  applyNewRoundStepMessage(msg: m.NewRoundStepMessage) {
    // TODO: ValidateHeight
    if (msg.height.lt(this.height)) {
      return;
    } else if (msg.height.eq(this.height)) {
      if (msg.round < this.round) {
        return;
      } else if (msg.round === this.round) {
        if (msg.step < this.step) {
          return;
        }
      }
    }

    if (!this.height.eq(msg.height) || this.round !== msg.round) {
      this.proposal = false;
      this.proposalBlockHash = undefined;
      this.proposalPOLRound = -1;
      this.proposalPOL = undefined;
      this.prevotes = undefined;
      this.precommits = undefined;
    }

    if (this.height.eq(msg.height) && this.round !== msg.round && this.catchupCommitRound === msg.round) {
      this.precommits = this.catchupCommit;
    }

    if (!this.height.eq(msg.height)) {
      this.catchupCommit = undefined;
      this.catchupCommitRound = -1;
    }

    this.height = msg.height.clone();
    this.round = msg.round;
    this.step = msg.step;
  }

  applyNewValidBlockMessage(msg: m.NewValidBlockMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    if (this.round !== msg.round && !msg.isCommit) {
      return;
    }

    this.proposalBlockHash = msg.hash;
  }

  applyProposalPOLMessage(msg: m.ProposalPOLMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    if (this.proposalPOLRound !== msg.proposalPOLRound) {
      return;
    }

    this.proposalPOL = msg.proposalPOL;
  }

  applyHasVoteMessage(msg: m.HasVoteMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    this.setHasVote(msg.height, msg.round, msg.type, msg.index);
  }

  applyVoteSetBitsMessage(msg: m.VoteSetBitsMessage) {
    // TODO: ourVotes??
    this.getVoteBitArray(msg.height, msg.round, msg.type)?.update(msg.votes);
  }

  private getVoteBitArray(height: BN, round: number, type: VoteType) {
    if (this.height.eq(height)) {
      if (round === this.round) {
        return type === VoteType.Prevote ? this.prevotes : this.precommits;
      } else if (round === this.catchupCommitRound) {
        if (type === VoteType.Precommit) {
          return this.catchupCommit;
        }
      } else if (round === this.proposalPOLRound) {
        if (type === VoteType.Prevote) {
          return this.proposalPOL;
        }
      }
    }
  }

  setHasVote(height: BN, round: number, type: VoteType, index: number) {
    this.getVoteBitArray(height, round, type)?.setIndex(index, true);
  }

  setHasProposal(proposal: Proposal) {
    if (!this.height.eq(proposal.height) || this.round !== proposal.round) {
      return;
    }

    if (this.proposal) {
      return;
    }

    this.proposal = true;

    // TODO: if it is set by NewValidBlockMessage, ignore
    this.proposalBlockHash = proposal.hash;
    this.proposalPOLRound = proposal.POLRound;
    this.proposalPOL = undefined;
  }

  ensureCatchupCommitRound(height: BN, round: number, valSetSize: number) {
    if (!this.height.eq(height)) {
      return;
    }

    if (this.catchupCommitRound === round) {
      return;
    }

    this.catchupCommitRound = round;
    if (this.round === round) {
      this.catchupCommit = this.precommits;
    } else {
      this.catchupCommit = new BitArray(valSetSize);
    }
  }

  ensureVoteBitArrays(height: BN, valSetSize: number) {
    if (this.height.eq(height)) {
      if (this.prevotes === undefined) {
        this.prevotes = new BitArray(valSetSize);
      }
      if (this.precommits === undefined) {
        this.precommits = new BitArray(valSetSize);
      }
      if (this.proposalPOL === undefined) {
        this.proposalPOL = new BitArray(valSetSize);
      }
      if (this.catchupCommit === undefined) {
        this.catchupCommit = new BitArray(valSetSize);
      }
    }
  }
}
