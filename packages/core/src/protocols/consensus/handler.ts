import { BN } from 'ethereumjs-util';
import { Channel, createBufferFunctionalSet, logger } from '@gxchain2/utils';
import { ReimintConsensusEngine } from '../../consensus/reimint/reimintConsensusEngine';
import { RoundStepType, Proposal, BitArray, VoteType, VoteSet, MessageFactory, Evidence, DuplicateVoteEvidence } from '../../consensus/reimint/types';
import * as m from '../../consensus/reimint/types/messages';
import { ConsensusProtocol } from './protocol';
import { Peer, ProtocolHandler } from '@gxchain2/network';

const peerGossipSleepDuration = 100;
const maxQueuedEvidence = 100;
const maxKnowEvidence = 100;

export class ConsensusProtocolHander implements ProtocolHandler {
  readonly peer: Peer;
  readonly protocol: ConsensusProtocol;

  private aborted: boolean = false;
  private evidenceQueue = new Channel<Evidence>({ max: maxQueuedEvidence });
  private _knowEvidence = createBufferFunctionalSet();

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

  constructor(protocol: ConsensusProtocol, peer: Peer) {
    this.peer = peer;
    this.protocol = protocol;
  }

  get reimint() {
    return this.protocol.node.getReimintEngine();
  }

  private onEngineStart = () => {
    this.gossipDataLoop(this.reimint!);
    this.gossipVotesLoop(this.reimint!);
    this.gossipEvidenceLoop();
  };

  private onEvidence = (ev: Evidence) => {
    this.evidenceQueue.push(ev);
  };

  private async gossipDataLoop(reimint: ReimintConsensusEngine) {
    while (!this.aborted) {
      try {
        if (!this.proposal) {
          const proposalMessage = reimint.state.genProposalMessage(this.height, this.round);
          if (proposalMessage) {
            // logger.debug('ConsensusProtocolHander::gossipDataLoop, send proposal to:', this.peer.peerId);
            this.send(proposalMessage);
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

  private async gossipEvidenceLoop() {
    for await (const evidence of this.evidenceQueue.generator()) {
      try {
        if (!this.isKnowEvidence(evidence)) {
          if (evidence instanceof DuplicateVoteEvidence) {
            this.knowEvidence(evidence);
            this.send(new m.DuplicateVoteEvidenceMessage(evidence));
          } else {
            logger.warn('ConsensusProtocolHander::gossipEvidenceLoop, unknown evidence:', evidence);
          }
        }
      } catch (err) {
        logger.error('ConsensusProtocolHander::gossipEvidenceLoop, catch error:', err);
      } finally {
        await new Promise((r) => setTimeout(r, peerGossipSleepDuration));
      }
    }
  }

  private knowEvidence(ev: Evidence) {
    if (this._knowEvidence.size >= maxKnowEvidence) {
      const { value } = this._knowEvidence.keys().next();
      this._knowEvidence.delete(value);
    }
    this._knowEvidence.add(ev.hash());
  }

  private isKnowEvidence(ev: Evidence) {
    return this._knowEvidence.has(ev.hash());
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
      this.send(new m.VoteMessage(vote));
      this.setHasVote(vote.height, vote.round, vote.type, vote.index);
      return true;
    }
    return false;
  }

  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake() {
    this.protocol.addHandler(this);

    const reimint = this.reimint;
    if (reimint) {
      reimint.evpool.on('evidence', this.onEvidence);
      for (const ev of reimint.evpool.pendingEvidence) {
        this.evidenceQueue.push(ev);
      }

      if (reimint.isStarted) {
        this.onEngineStart();
      } else {
        reimint.on('start', this.onEngineStart);
      }

      const newRoundMsg = reimint.state.genNewRoundStepMessage();
      newRoundMsg && this.send(newRoundMsg);
    }

    return true;
  }

  /**
   * {@link ProtocolHandler.abort}
   */
  abort() {
    this.aborted = true;
    this.reimint?.off('start', this.onEngineStart);
    this.reimint?.evpool.off('evidence', this.onEvidence);
    this.protocol.removeHandler(this);
    this.evidenceQueue.abort();
  }

  /**
   * Send message to the remote peer
   * @param msg - Messsage
   */
  send(msg: m.Message) {
    this.peer.send(this.protocol.name, MessageFactory.serializeMessage(msg));
  }

  /**
   * {@link ProtocolHandler.handle}
   */
  async handle(data: Buffer) {
    const msg = MessageFactory.fromSerializedMessage(data);
    if (msg instanceof m.NewRoundStepMessage) {
      this.applyNewRoundStepMessage(msg);
    } else if (msg instanceof m.NewValidBlockMessage) {
      this.applyNewValidBlockMessage(msg);
    } else if (msg instanceof m.HasVoteMessage) {
      this.applyHasVoteMessage(msg);
    } else if (msg instanceof m.ProposalMessage) {
      this.setHasProposal(msg.proposal);
      this.reimint?.state.newMessage(this.peer.peerId, msg);
    } else if (msg instanceof m.ProposalPOLMessage) {
      this.applyProposalPOLMessage(msg);
    } else if (msg instanceof m.VoteMessage) {
      if (this.reimint) {
        const vote = msg.vote;
        this.ensureVoteBitArrays(vote.height, this.reimint.state.getValSetSize());
        this.setHasVote(vote.height, vote.round, vote.type, vote.index);
        this.reimint.state.newMessage(this.peer.peerId, msg);
      }
    } else if (msg instanceof m.VoteSetMaj23Message) {
      if (this.reimint) {
        this.reimint.state.setVoteMaj23(msg.height, msg.round, msg.type, this.peer.peerId, msg.hash);
        const voteSetBitsMessage = this.reimint.state.genVoteSetBitsMessage(msg.height, msg.round, msg.type, msg.hash);
        voteSetBitsMessage && this.send(voteSetBitsMessage);
      }
    } else if (msg instanceof m.VoteSetBitsMessage) {
      this.applyVoteSetBitsMessage(msg);
    } else if (msg instanceof m.GetProposalBlockMessage) {
      const proposalBlock = this.protocol.node.getReimintEngine()?.state.getProposalBlock(msg.hash);
      proposalBlock && this.send(new m.ProposalBlockMessage(proposalBlock));
    } else if (msg instanceof m.ProposalBlockMessage) {
      this.reimint?.state.newMessage(this.peer.peerId, msg);
    } else if (msg instanceof m.DuplicateVoteEvidenceMessage) {
      this.knowEvidence(msg.evidence);
      this.reimint?.evpool.addEvidence(msg.evidence).catch((err) => {
        logger.error('ConsensusProtocolHander::handle, addEvidence, catch error:', err);
      });
    } else {
      logger.warn('ConsensusProtocolHander::handle, unknown message');
    }
  }

  private applyNewRoundStepMessage(msg: m.NewRoundStepMessage) {
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

  private applyNewValidBlockMessage(msg: m.NewValidBlockMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    if (this.round !== msg.round && !msg.isCommit) {
      return;
    }

    this.proposalBlockHash = msg.hash;
  }

  private applyProposalPOLMessage(msg: m.ProposalPOLMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    if (this.proposalPOLRound !== msg.proposalPOLRound) {
      return;
    }

    this.proposalPOL = msg.proposalPOL;
  }

  private applyHasVoteMessage(msg: m.HasVoteMessage) {
    if (!this.height.eq(msg.height)) {
      return;
    }

    this.setHasVote(msg.height, msg.round, msg.type, msg.index);
  }

  private applyVoteSetBitsMessage(msg: m.VoteSetBitsMessage) {
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

  private setHasVote(height: BN, round: number, type: VoteType, index: number) {
    this.getVoteBitArray(height, round, type)?.setIndex(index, true);
  }

  private setHasProposal(proposal: Proposal) {
    if (!this.height.eq(proposal.height) || this.round !== proposal.round) {
      return;
    }

    if (this.proposal) {
      return;
    }

    this.proposal = true;
    this.proposalBlockHash = proposal.hash;
    this.proposalPOLRound = proposal.POLRound;
    this.proposalPOL = undefined;
  }

  private ensureCatchupCommitRound(height: BN, round: number, valSetSize: number) {
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

  private ensureVoteBitArrays(height: BN, valSetSize: number) {
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
