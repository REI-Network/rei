import { BN } from 'ethereumjs-util';
import { Channel, FunctionalBufferSet, logger } from '@rei-network/utils';
import { Peer, ProtocolStream, ProtocolHandler } from '@rei-network/network';
import { RoundStepType, Proposal, Vote, BitArray, VoteType, VoteSet, MessageFactory, Evidence, DuplicateVoteEvidence } from '../../consensus/reimint';
import * as m from '../../consensus/reimint/messages';
import { ConsensusProtocol } from './protocol';

const peerGossipSleepDuration = 100;
const maxQueuedEvidence = 100;
const maxKnowEvidence = 100;

export class ConsensusProtocolHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly stream: ProtocolStream;
  readonly protocol: ConsensusProtocol;

  private aborted: boolean = false;
  private evidenceQueue = new Channel<Evidence>({ max: maxQueuedEvidence });

  private _knowEvidence = new FunctionalBufferSet();

  protected handshakeResolve?: (result: boolean) => void;
  protected handshakeTimeout?: NodeJS.Timeout;
  protected readonly handshakePromise: Promise<boolean>;

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

  constructor(protocol: ConsensusProtocol, peer: Peer, stream: ProtocolStream) {
    this.peer = peer;
    this.stream = stream;
    this.protocol = protocol;

    this.handshakePromise = new Promise<boolean>((resolve) => {
      this.handshakeResolve = resolve;
    });
    this.handshakePromise.then((result) => {
      if (result) {
        this.protocol.addHandler(this);

        // start gossip loop
        if (this.reimint.isStarted) {
          this.onEngineStart();
        } else {
          this.reimint.on('start', this.onEngineStart);
        }

        // send round step message
        const newRoundMsg = this.reimint.state.genNewRoundStepMessage();
        newRoundMsg && this.send(newRoundMsg);
      }
    });
  }

  get node() {
    return this.protocol.node;
  }

  get reimint() {
    return this.protocol.node.reimint;
  }

  private onEngineStart = () => {
    // broadcast all cached evidence
    for (const ev of this.node.reimint.evpool.pendingEvidence) {
      this.evidenceQueue.push(ev);
    }

    this.gossipDataLoop();
    this.gossipVotesLoop();
    this.gossipEvidenceLoop();
  };

  private async gossipDataLoop() {
    while (!this.aborted) {
      try {
        if (!this.proposal) {
          const proposalMessage = this.reimint.state.genProposalMessage(this.height, this.round);
          if (proposalMessage) {
            // logger.debug('ConsensusProtocolHandler::gossipDataLoop, send proposal to:', this.peer.peerId);
            this.send(proposalMessage);
            this.setHasProposal(proposalMessage.proposal);
          }
        }
      } catch (err) {
        logger.error('ConsensusProtocolHandler::gossipDataLoop, catch error:', err);
      }

      await new Promise((r) => setTimeout(r, peerGossipSleepDuration));
    }
  }

  private async gossipVotesLoop() {
    while (!this.aborted) {
      try {
        // pick vote from memory and send
        const votes = this.reimint.state.pickVoteSetToSend(this.height, this.round, this.proposalPOLRound, this.step);
        if (votes && this.pickAndSend(votes)) {
          continue;
        }
      } catch (err) {
        logger.error('ConsensusProtocolHandler::gossipVotesLoop, catch error:', err);
      }

      await new Promise((r) => setTimeout(r, peerGossipSleepDuration));
    }
  }

  private async gossipEvidenceLoop() {
    for await (const evidence of this.evidenceQueue) {
      try {
        if (!this.isKnowEvidence(evidence)) {
          if (evidence instanceof DuplicateVoteEvidence) {
            this.knowEvidence(evidence);
            this.send(new m.DuplicateVoteEvidenceMessage(evidence));
          } else {
            logger.warn('ConsensusProtocolHandler::gossipEvidenceLoop, unknown evidence:', evidence);
          }
        }
      } catch (err) {
        logger.error('ConsensusProtocolHandler::gossipEvidenceLoop, catch error:', err);
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
      // logger.debug('ConsensusProtocolHandler::gossipDataLoop, send vote(h,r,h,t):', vote.height.toString(), vote.round, bufferToHex(vote.hash), vote.type, 'to:', this.peer.peerId);
      this.sendVote(vote);
      return true;
    }
    return false;
  }

  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake() {
    if (!this.handshakeResolve) {
      throw new Error('repeated handshake');
    }
    const status = this.protocol.node.status;
    const { height, round, step, prevotes, precommits } = this.reimint.state.getHandshakeInfo();
    this.send(new m.HandshakeMessage(status.networkId, status.genesisHash, height, round, step, prevotes, precommits));
    this.handshakeTimeout = setTimeout(() => {
      this.handshakeTimeout = undefined;
      if (this.handshakeResolve) {
        this.handshakeResolve(false);
        this.handshakeResolve = undefined;
      }
    }, 2000);
    return this.handshakePromise;
  }

  /**
   * {@link ProtocolHandler.abort}
   */
  abort() {
    this.aborted = true;
    this.reimint.off('start', this.onEngineStart);
    this.protocol.removeHandler(this);
    this.evidenceQueue.abort();
  }

  /**
   * Send message to the remote peer
   * @param msg - Messsage
   */
  send(msg: m.Message) {
    try {
      this.stream.send(MessageFactory.serializeMessage(msg));
    } catch (err) {
      // ignore errors...
    }
  }

  /**
   * Add evidence to evidence queue
   * @param evidence - Target evidence
   */
  sendEvidence(evidence: Evidence) {
    if (!this.isKnowEvidence(evidence)) {
      this.evidenceQueue.push(evidence);
    }
  }

  /**
   * Send vote to remote peer immediately
   * @param vote - Vote
   */
  sendVote(vote: Vote) {
    if (this.setHasVote(vote.height, vote.round, vote.type, vote.index)) {
      this.send(new m.VoteMessage(vote));
    }
  }

  /**
   * {@link ProtocolHandler.handle}
   */
  async handle(data: Buffer) {
    const msg = MessageFactory.fromSerializedMessage(data);
    if (msg instanceof m.HandshakeMessage) {
      this.applyHandshakeMessage(msg);
    } else if (msg instanceof m.NewRoundStepMessage) {
      this.applyNewRoundStepMessage(msg);
    } else if (msg instanceof m.NewValidBlockMessage) {
      this.applyNewValidBlockMessage(msg);
    } else if (msg instanceof m.HasVoteMessage) {
      this.applyHasVoteMessage(msg);
    } else if (msg instanceof m.ProposalMessage) {
      this.setHasProposal(msg.proposal);
      // pre validate the proposal message before adding it to the state machine message queue
      if (this.reimint.state.preValidateProposal(msg.proposal)) {
        this.reimint.state.newMessage(this.peer.peerId, msg);
      }
    } else if (msg instanceof m.ProposalPOLMessage) {
      this.applyProposalPOLMessage(msg);
    } else if (msg instanceof m.VoteMessage) {
      const vote = msg.vote;
      this.ensureVoteBitArrays(vote.height, this.reimint.state.getValSetSize());
      this.setHasVote(vote.height, vote.round, vote.type, vote.index);
      // pre validate the vote message before adding it to the state machine message queue
      if (this.reimint.state.preValidateVote(msg.vote)) {
        this.reimint.state.newMessage(this.peer.peerId, msg);
      }
    } else if (msg instanceof m.VoteSetMaj23Message) {
      this.reimint.state.setVoteMaj23(msg.height, msg.round, msg.type, this.peer.peerId, msg.hash);
      const voteSetBitsMessage = this.reimint.state.genVoteSetBitsMessage(msg.height, msg.round, msg.type, msg.hash);
      voteSetBitsMessage && this.send(voteSetBitsMessage);
    } else if (msg instanceof m.VoteSetBitsMessage) {
      this.applyVoteSetBitsMessage(msg);
    } else if (msg instanceof m.GetProposalBlockMessage) {
      const proposalBlock = this.reimint.state.getProposalBlock(msg.hash);
      proposalBlock && this.send(new m.ProposalBlockMessage(proposalBlock));
    } else if (msg instanceof m.ProposalBlockMessage) {
      // check if we need the proposal block message before adding it to the state machine message queue
      if (this.reimint.state.preValidateProposalBlock()) {
        this.reimint.state.newMessage(this.peer.peerId, msg);
      }
    } else if (msg instanceof m.DuplicateVoteEvidenceMessage) {
      this.knowEvidence(msg.evidence);
      this.reimint.addEvidence(msg.evidence).catch((err) => {
        logger.error('ConsensusProtocolHandler::handle, addEvidence, catch error:', err);
      });
    } else {
      logger.warn('ConsensusProtocolHandler::handle, unknown message');
    }
  }

  private applyHandshakeMessage(msg: m.HandshakeMessage) {
    if (this.handshakeResolve) {
      const localStatus = this.protocol.node.status;
      const result = localStatus.genesisHash.equals(msg.genesisHash) && localStatus.networkId === msg.networkId;
      this.handshakeResolve(result);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }

      if (result) {
        // save remote round state and votes info
        this.height = msg.height.clone();
        this.round = msg.round;
        this.step = msg.step;
        this.prevotes = msg.prevotes;
        this.precommits = msg.precommits;
      }
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
    return !!this.getVoteBitArray(height, round, type)?.setIndex(index, true);
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

  /**
   * Get remote peer status
   * @returns Status
   */
  getRemoteStatus() {
    return { name: this.protocol.name, version: Number(this.protocol.version), height: this.height.toNumber(), round: this.round, step: this.step };
  }
}
