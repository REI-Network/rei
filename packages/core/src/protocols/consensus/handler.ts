import { rlp, BN, bnToUnpaddedBuffer, intToBuffer } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Message, NewRoundStepMessage, NewValidBlockMessage, HasVoteMessage, Proposal, Vote, ProposalPOLMessage, VoteSetMaj23Message, VoteSetBitsMessage, GetProposalBlockMessage, ProposalBlockMessage, BitArray, ReimintConsensusEngine, RoundStepType, VoteType, ProposalMessage, VoteMessage } from '../../consensus/reimint';
import { ConsensusType } from '../../consensus/types';
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
    },
    process(this: ConsensusProtocolHander, msg: NewRoundStepMessage) {
      this.handshakeResponse(msg);
      this.applyNewRoundStepMessage(msg);
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
    },
    process(this: ConsensusProtocolHander, msg: NewValidBlockMessage) {
      this.applyNewValidBlockMessage(msg);
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
    },
    process(this: ConsensusProtocolHander, msg: HasVoteMessage) {
      this.applyHasVoteMessage(msg);
    }
  },
  {
    name: 'Proposal',
    code: 3,
    encode(this: ConsensusProtocolHander, data: ProposalMessage) {
      return data.proposal.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): ProposalMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return new ProposalMessage(Proposal.fromValuesArray(data as any));
    },
    process(this: ConsensusProtocolHander, msg: ProposalMessage) {
      this.setHasProposal(msg.proposal);
      this.reimint?.receiveMessage(this.peer.peerId, msg);
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
    },
    process(this: ConsensusProtocolHander, msg: ProposalPOLMessage) {
      this.applyProposalPOLMessage(msg);
    }
  },
  {
    name: 'Vote',
    code: 5,
    encode(this: ConsensusProtocolHander, data: VoteMessage) {
      return data.vote.raw();
    },
    decode(this: ConsensusProtocolHander, data: any): VoteMessage {
      if (!Array.isArray(data)) {
        throw new Error('invalid values');
      }
      return new VoteMessage(Vote.fromValuesArray(data as any));
    },
    process(this: ConsensusProtocolHander, msg: VoteMessage) {
      const reimint = this.reimint;
      if (reimint) {
        const vote = msg.vote;
        this.ensureVoteBitArrays(vote.height, reimint.state.getValSetSize());
        this.setHasVote(vote.height, vote.round, vote.type, vote.index);
        reimint.receiveMessage(this.peer.peerId, msg);
      }
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
    },
    process(this: ConsensusProtocolHander, msg: VoteSetMaj23Message) {
      const reimint = this.reimint;
      if (reimint) {
        reimint.state.setVoteMaj23(msg.height, msg.round, msg.type, this.peer.peerId, msg.hash);
        const response = reimint.state.genVoteSetBitsMessage(msg.height, msg.round, msg.type, msg.hash);
        response && this.sendMessage(response);
      }
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
    },
    process(this: ConsensusProtocolHander, msg: VoteSetBitsMessage) {
      this.applyVoteSetBitsMessage(msg);
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
    },
    process(this: ConsensusProtocolHander, { hash }: GetProposalBlockMessage) {
      const proposalBlock = this.reimint?.state.getProposalBlock(hash);
      proposalBlock && this.sendMessage(new ProposalBlockMessage(proposalBlock));
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
    },
    process(this: ConsensusProtocolHander, msg: ProposalBlockMessage) {
      this.reimint?.receiveMessage(this.peer.peerId, msg);
    }
  },
  // debug code
  {
    name: 'hellow',
    code: 10,
    encode(this: ConsensusProtocolHander, data: string) {
      return Buffer.from(data);
    },
    decode(this: ConsensusProtocolHander, data: Buffer): string {
      logger.debug('receive hellow, data:', data.toString());
      return data.toString();
    }
  }
];

export interface ConsensusProtocolHanderOptions extends Omit<HandlerBaseOptions, 'handlerFuncs'> {}

export class ConsensusProtocolHander extends HandlerBase<NewRoundStepMessage> {
  /////////////// PeerRoundState ///////////////
  private height: BN = new BN(0);
  private round: number = -1;
  private step: RoundStepType = RoundStepType.NewHeight;

  // Estimated start of round 0 at this height
  private startTime!: number;

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
    ConsensusProtocol.getPool().add(this);
  }
  protected onHandshake() {
    const roundStep = new NewRoundStepMessage(new BN(0), 1, 2, 3, 4);
    this.send(0, roundStep);
  }
  protected onHandshakeResponse(roundStep: any) {
    if (!(roundStep instanceof NewRoundStepMessage)) {
      return false;
    }
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

  get reimint() {
    const reimint = this.node.engines.get(ConsensusType.Reimint);
    return reimint ? (reimint as ReimintConsensusEngine) : undefined;
  }

  sendMessage(msg: Message) {
    if (msg instanceof NewRoundStepMessage) {
      this.send(0, msg);
    } else if (msg instanceof NewValidBlockMessage) {
      this.send(1, msg);
    } else if (msg instanceof HasVoteMessage) {
      this.send(2, msg);
    } else if (msg instanceof ProposalMessage) {
      this.send(3, msg);
    } else if (msg instanceof ProposalPOLMessage) {
      this.send(4, msg);
    } else if (msg instanceof VoteMessage) {
      this.send(5, msg);
    } else if (msg instanceof VoteSetMaj23Message) {
      this.send(6, msg);
    } else if (msg instanceof VoteSetBitsMessage) {
      this.send(7, msg);
    } else if (msg instanceof GetProposalBlockMessage) {
      this.send(8, msg);
    } else if (msg instanceof ProposalBlockMessage) {
      this.send(9, msg);
    } else {
      throw new Error('invalid message');
    }
  }

  applyNewRoundStepMessage(msg: NewRoundStepMessage) {
    // TODO: ValidateHeight
    if (msg.height.lt(this.height) || msg.round < this.round || msg.step < this.step) {
      logger.debug('ConsensusProtocolHander::applyNewRoundStepMessage, peerId:', this.peer.peerId, 'ignore new round step due to decrease, local:', this.height.toNumber(), this.round, this.step, 'remote:', msg.height.toNumber(), msg.round, msg.step);
      return;
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
    this.startTime = Date.now() - msg.secondsSinceStartTime;

    logger.debug('ConsensusProtocolHander::applyNewRoundStepMessage, peerId:', this.peer.peerId, 'new round step:', msg.height.toNumber(), msg.round, msg.step);
  }

  applyNewValidBlockMessage(msg: NewValidBlockMessage) {
    if (!this.height.eq(msg.height)) {
      logger.debug('ConsensusProtocolHander::applyNewValidBlockMessage, peerId:', this.peer.peerId, 'unequal height, local:', this.height.toNumber(), 'remote:', msg.height.toNumber());
      return;
    }

    if (this.round !== msg.round && !msg.isCommit) {
      logger.debug('ConsensusProtocolHander::applyNewValidBlockMessage, peerId:', this.peer.peerId, 'unequal round, local:', this.round, 'remote:', msg.round);
      return;
    }

    this.proposalBlockHash = msg.hash;

    logger.debug('ConsensusProtocolHander::applyNewValidBlockMessage, peerId:', this.peer.peerId, 'applied');
  }

  applyProposalPOLMessage(msg: ProposalPOLMessage) {
    if (!this.height.eq(msg.height)) {
      logger.debug('ConsensusProtocolHander::applyProposalPOLMessage, peerId:', this.peer.peerId, 'unequal height, local:', this.height.toNumber(), 'remote:', msg.height.toNumber());
      return;
    }

    if (this.proposalPOLRound !== msg.proposalPOLRound) {
      logger.debug('ConsensusProtocolHander::applyProposalPOLMessage, peerId:', this.peer.peerId, 'unequal proposal POL round, local:', this.proposalPOLRound, 'remote:', msg.proposalPOLRound);
      return;
    }

    this.proposalPOL = msg.proposalPOL;

    logger.debug('ConsensusProtocolHander::applyProposalPOLMessage, peerId:', this.peer.peerId, 'applied');
  }

  applyHasVoteMessage(msg: HasVoteMessage) {
    if (!this.height.eq(msg.height)) {
      logger.debug('ConsensusProtocolHander::applyHasVote, peerId:', this.peer.peerId, 'unequal height, local:', this.height.toNumber(), 'remote:', msg.height.toNumber());
      return;
    }

    this.setHasVote(msg.height, msg.round, msg.type, msg.index);
  }

  applyVoteSetBitsMessage(msg: VoteSetBitsMessage) {
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
      logger.debug('ConsensusProtocolHander::setHasProposal, unequal height or round, local:', this.height.toNumber(), this.round, 'remote:', proposal.height.toNumber(), proposal.round);
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

    logger.debug('ConsensusProtocolHander::setHasProposal, peerId:', this.peer.peerId, 'applied');
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

  // debug code
  sayHellow() {
    this.send(10, 'wuhu');
  }
}
