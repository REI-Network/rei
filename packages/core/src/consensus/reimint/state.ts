import { Address, BN, intToBuffer, ecsign, bufferToHex } from 'ethereumjs-util';
import { Channel, logger } from '@gxchain2/utils';
import { Block, BlockHeader } from '@gxchain2/structure';
import { Node } from '../../node';
import { ValidatorSet } from '../../staking';
import { PendingBlock } from '../../worker';
import { HeightVoteSet, Vote, VoteType, ConflictingVotesError } from './vote';
import { TimeoutTicker } from './timeoutTicker';
import { ReimintConsensusEngine } from './reimint';
import { isEmptyHash, EMPTY_HASH } from '../utils';
import { Proposal } from './proposal';
import { Message, NewRoundStepMessage, NewValidBlockMessage, VoteMessage, ProposalBlockMessage, GetProposalBlockMessage, ProposalMessage, HasVoteMessage, VoteSetBitsMessage } from './messages';

export interface Signer {
  address(): Address;
  sign(msg: Buffer): Buffer;
}

export interface EvidencePool {
  reportConflictingVotes(voteA: Vote, voteB: Vote);
}

/////////////////////// mock ///////////////////////

export class MockEvidencePool implements EvidencePool {
  reportConflictingVotes(voteA: Vote, voteB: Vote) {
    logger.debug('receive evidence:', voteA, voteB);
  }
}

export class MockSigner implements Signer {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  address(): Address {
    return this.node.getCurrentEngine().coinbase;
  }

  sign(msg: Buffer): Buffer {
    const coinbase = this.node.getCurrentEngine().coinbase;
    if (coinbase.equals(Address.zero())) {
      throw new Error('empty coinbase');
    }
    const signature = ecsign(msg, this.node.accMngr.getPrivateKey(coinbase));
    return Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
  }
}

/////////////////////// mock ///////////////////////

export enum RoundStepType {
  NewHeight = 1,
  NewRound,
  Propose,
  Prevote,
  PrevoteWait,
  Precommit,
  PrecommitWait,
  Commit
}

export type StateMachineMessage = MessageInfo | TimeoutInfo;

export type MessageInfo = {
  peerId: string;
  msg: Message;
};

export type TimeoutInfo = {
  duration: number;
  height: BN;
  round: number;
  step: RoundStepType;
};

function isMessageInfo(smsg: StateMachineMessage): smsg is MessageInfo {
  return 'peerId' in smsg;
}

/////////////////////// config ///////////////////////

const SkipTimeoutCommit = true;
const WaitForTxs = true;
const CreateEmptyBlocksInterval = 0;
const StateMachineMsgQueueMaxSize = 10;

// TODO: config
function proposeDuration(round: number) {
  return 3000 + 500 * round;
}

function prevoteDuration(round: number) {
  return 1000 + 500 * round;
}

function precommitDutaion(round: number) {
  return 1000 + 500 * round;
}

function commitTimeout(time: number) {
  return 1000 + time;
}

/////////////////////// config ///////////////////////

export class StateMachine {
  private readonly node: Node;
  // TODO:
  private readonly signer?: Signer;
  // TODO:
  private readonly evpool: EvidencePool;
  private readonly timeoutTicker = new TimeoutTicker((ti) => {
    this._newMessage(ti);
  });

  private msgLoopPromise?: Promise<void>;
  private readonly msgQueue = new Channel<StateMachineMessage>({
    max: StateMachineMsgQueueMaxSize,
    drop: (smsg) => {
      logger.warn('StateMachine::drop, too many messages, drop:', smsg);
    }
  });

  // statsMsgQueue = new Channel<any>();

  private readonly reimint: ReimintConsensusEngine;
  private parentHash!: Buffer;
  private triggeredTimeoutPrecommit: boolean = false;

  /////////////// RoundState ///////////////
  private height: BN = new BN(0);
  private round: number = 0;
  private step: RoundStepType = RoundStepType.NewHeight;
  private startTime!: number;

  private commitTime?: number;
  private validators!: ValidatorSet;
  private proposal?: Proposal;
  private proposalBlockHash?: Buffer;
  private proposalBlock?: Block;
  private pendingBlock?: PendingBlock;

  private lockedRound: number = -1;
  private lockedBlock?: Block;

  private validRound: number = -1;
  private validBlock?: Block;

  private votes!: HeightVoteSet;
  private commitRound: number = -1;
  /////////////// RoundState ///////////////

  constructor(node: Node, remint: ReimintConsensusEngine, signer?: Signer) {
    this.node = node;
    this.reimint = remint;
    this.evpool = new MockEvidencePool();
    this.signer = signer ?? (this.reimint.coinbase.equals(Address.zero()) ? undefined : new MockSigner(node));
  }

  private newStep(timestamp?: number) {
    this.reimint.node.broadcastMessage(this.genNewRoundStepMessage(timestamp)!, { broadcast: true });
  }

  async msgLoop() {
    for await (const smsg of this.msgQueue.generator()) {
      try {
        if (isMessageInfo(smsg)) {
          this.handleMsg(smsg);
        } else {
          this.handleTimeout(smsg);
        }
      } catch (err) {
        logger.error('State::msgLoop, catch error:', err);
      }
    }
  }

  private handleMsg(mi: MessageInfo) {
    const { msg, peerId } = mi;

    if (msg instanceof ProposalMessage) {
      this.setProposal(msg.proposal, peerId);
    } else if (msg instanceof ProposalBlockMessage) {
      this.addProposalBlock(msg.block);
      // statsMsgQueue <- mi
    } else if (msg instanceof VoteMessage) {
      this.tryAddVote(msg.vote, peerId);
      // statsMsgQueue <- mi
    } else {
      throw new Error('unknown msg type');
    }
  }

  private handleTimeout(ti: TimeoutInfo) {
    console.log('enter handleTimeout', ti);
    if (!ti.height.eq(this.height) || ti.round < this.round || (ti.round === this.round && ti.step < this.step)) {
      logger.debug('StateMachine::handleTimeout, ignoring tock because we are ahead:', ti, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    switch (ti.step) {
      case RoundStepType.NewHeight:
        this.enterNewRound(ti.height, 0);
        break;
      case RoundStepType.NewRound:
        this.enterPropose(ti.height, 0);
        break;
      case RoundStepType.Propose:
        // TODO: emit a event
        this.enterPrevote(ti.height, ti.round);
        break;
      case RoundStepType.PrevoteWait:
        this.enterPrecommit(ti.height, ti.round);
        break;
      case RoundStepType.PrecommitWait:
        this.enterPrecommit(ti.height, ti.round);
        this.enterNewRound(ti.height, ti.round + 1);
        break;
      default:
        throw new Error('invalid timeout step');
    }
  }

  // private handleTxsAvailable() {}

  private setProposal(proposal: Proposal, peerId: string) {
    console.log('enter setProposal');
    if (this.proposal) {
      console.log('repeat setProposal');
      return;
    }

    if (!this.height.eq(proposal.height) || this.round !== proposal.round) {
      console.log('invalid setProposal');
      return;
    }

    if (proposal.POLRound < -1 || (proposal.POLRound >= 0 && proposal.POLRound >= proposal.round)) {
      throw new Error('invalid proposal POL round');
    }

    proposal.validateSignature(this.validators.proposer);

    this.proposal = proposal;
    this.proposalBlockHash = proposal.hash;
    if (this.proposalBlock === undefined && peerId !== '') {
      this.reimint.node.broadcastMessage(new GetProposalBlockMessage(proposal.hash), { to: peerId });
    }
  }

  private isProposalComplete() {
    if (this.proposal === undefined || this.proposalBlock === undefined) {
      return false;
    }

    if (this.proposal.POLRound < 0) {
      return true;
    }

    return !!this.votes.prevotes(this.proposal.POLRound)?.hasTwoThirdsMajority();
  }

  private addProposalBlock(block: Block) {
    console.log('enter addProposalBlock');
    if (this.proposalBlock) {
      console.log('repeat addProposalBlock');
      return;
    }
    if (this.proposalBlockHash === undefined) {
      throw new Error('add proposal block when hash is undefined');
    }
    if (!this.proposalBlockHash.equals(block.hash())) {
      throw new Error('invalid proposal block');
    }
    // TODO: validate block?
    this.proposalBlock = block;
    logger.debug('StateMachine::addProposalBlock, applied');
    const prevotes = this.votes.prevotes(this.round);
    const maj23Hash = prevotes?.maj23;
    if (maj23Hash && !isEmptyHash(maj23Hash) && this.validRound < this.round) {
      if (this.proposalBlockHash.equals(maj23Hash)) {
        logger.debug('StateMachine::addProposalBlock, update valid block, round:', this.round, 'hash:', bufferToHex(maj23Hash));

        this.validRound = this.round;
        this.validBlock = this.proposalBlock;
      }
    }

    if (this.step <= RoundStepType.Propose && this.isProposalComplete()) {
      this.enterPrevote(this.height, this.round);
      if (maj23Hash) {
        this.enterPrecommit(this.height, this.round);
      }
    } else if (this.step === RoundStepType.Commit) {
      this.tryFinalizeCommit(this.height);
    }
  }

  private addVote(vote: Vote, peerId: string) {
    logger.debug('StateMachine::addVote, vote:', vote.height.toNumber(), 'hash:', vote.hash.toString('hex'), 'type:', vote.type, 'from:', peerId);

    if (!vote.height.eq(vote.height)) {
      logger.debug('StateMachine::addVote, unequal height, ignore, vote:', vote.height.toString(), 'state machine:', this.height.toString());
      return;
    }

    this.votes.addVote(vote, peerId);
    // TODO: if add failed, return

    this.reimint.node.broadcastMessage(new HasVoteMessage(vote.height, vote.round, vote.type, vote.index), { exclude: [peerId] });

    switch (vote.type) {
      case VoteType.Prevote:
        {
          const prevotes = this.votes.prevotes(vote.round);
          const maj23Hash = prevotes?.maj23;
          if (maj23Hash) {
            // try to unlock ourself
            if (this.lockedBlock !== undefined && this.lockedRound < vote.round && vote.round <= this.round && !this.lockedBlock.hash().equals(maj23Hash)) {
              this.lockedRound = -1;
              this.lockedBlock = undefined;

              // TODO: emit unlock event
            }

            // try to update valid block
            if (!isEmptyHash(maj23Hash) && this.validRound < vote.round && vote.round === this.round) {
              if (this.proposalBlockHash && this.proposalBlockHash.equals(maj23Hash)) {
                logger.debug('StateMachine::addVote, update valid block, round:', this.round, 'hash:', bufferToHex(maj23Hash));

                this.validRound = vote.round;
                this.validBlock = this.proposalBlock;
              } else {
                this.proposalBlock = undefined;
              }

              if (!this.proposalBlockHash || !this.proposalBlockHash.equals(maj23Hash)) {
                this.proposalBlockHash = maj23Hash;
              }

              this.reimint.node.broadcastMessage(new NewValidBlockMessage(this.height, this.round, this.proposalBlockHash, this.step === RoundStepType.Commit), { broadcast: true });
            }
          }

          if (this.round < vote.round && prevotes?.hasTwoThirdsAny()) {
            this.enterNewRound(this.height, vote.round);
          } else if (this.round === vote.round && RoundStepType.Prevote <= this.step) {
            if (maj23Hash && (this.isProposalComplete() || isEmptyHash(maj23Hash))) {
              this.enterPrecommit(this.height, vote.round);
            } else if (prevotes?.hasTwoThirdsAny()) {
              this.enterPrevoteWait(this.height, vote.round);
            }
          } else if (this.proposal !== undefined && 0 <= this.proposal.POLRound && this.proposal.POLRound === vote.round) {
            if (this.isProposalComplete()) {
              this.enterPrevote(this.height, this.round);
            }
          }
        }
        break;
      case VoteType.Precommit:
        {
          const precommits = this.votes.precommits(vote.round);
          const maj23Hash = precommits?.maj23;
          if (maj23Hash) {
            this.enterNewRound(this.height, vote.round);
            this.enterPrecommit(this.height, vote.round);

            if (!isEmptyHash(maj23Hash)) {
              this.enterCommit(this.height, vote.round);
              if (SkipTimeoutCommit) {
                this.enterNewRound(this.height, 0);
              }
            } else {
              this.enterPrecommitWait(this.height, vote.round);
            }
          } else if (this.round <= vote.round && precommits?.hasTwoThirdsAny()) {
            this.enterNewRound(this.height, vote.round);
            this.enterPrecommitWait(this.height, vote.round);
          }
        }
        break;
      default:
        throw new Error('unexpected vote type');
    }
  }

  private tryAddVote(vote: Vote, peerId: string) {
    try {
      this.addVote(vote, peerId);
    } catch (err) {
      if (err instanceof ConflictingVotesError) {
        // if (!this.signer) {
        //   return;
        // }
        if (this.signer && vote.validator().equals(this.signer.address())) {
          // found conflicting vote from ourselves
          return;
        }
        const { voteA, voteB } = err;
        this.evpool.reportConflictingVotes(voteA, voteB);
      } else {
        logger.warn('StateMachine::tryAddVote, catch error:', err);
      }
    }
  }

  private enterNewRound(height: BN, round: number) {
    console.log('enter enterNewRound');

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.step !== RoundStepType.NewHeight)) {
      logger.debug('StateMachine::enterNewRound, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    if (this.startTime > Date.now()) {
      logger.debug('...?');
    }

    let validators = this.validators;
    if (this.round < round) {
      validators = validators.copy();
      validators.incrementProposerPriority(round - this.round);
    }

    this.round = round;
    this.step = RoundStepType.NewRound;
    this.validators = validators;
    if (round === 0) {
      // do nothing
    } else {
      this.proposal = undefined;
      this.proposalBlock = undefined;
      this.proposalBlockHash = undefined;
    }

    this.votes.setRound(round + 1);
    this.triggeredTimeoutPrecommit = false;

    const waitForTxs = WaitForTxs && round === 0;
    if (waitForTxs) {
      if (CreateEmptyBlocksInterval > 0) {
        this.timeoutTicker.schedule({
          duration: CreateEmptyBlocksInterval,
          step: RoundStepType.NewRound,
          height: height.clone(),
          round
        });
      } else {
        this.enterPropose(height, 0);
      }
    } else {
      this.enterPropose(height, round);
    }
  }

  private async createBlockAndProposal() {
    if (!this.pendingBlock || !this.pendingBlock.parentHash.equals(this.parentHash)) {
      throw new Error('missing pending block');
    }

    const blockData = await this.pendingBlock.finalize(this.round);
    return this.reimint.generateBlockAndProposal(blockData.header, blockData.transactions, {
      round: this.round,
      POLRound: this.validRound,
      validatorSetSize: this.validators.length,
      common: this.pendingBlock.common
    }) as { block: Block; proposal: Proposal };
  }

  private decideProposal(height: BN, round: number) {
    if (this.validBlock) {
      const block = this.validBlock;
      const proposal = new Proposal({
        type: VoteType.Proposal,
        height,
        round,
        hash: block.hash(),
        POLRound: this.validRound,
        timestamp: Date.now()
      });
      proposal.signature = this.signer!.sign(proposal.getMessageToSign());

      this._newMessage({
        msg: new ProposalMessage(proposal),
        peerId: ''
      });
      this._newMessage({
        msg: new ProposalBlockMessage(block),
        peerId: ''
      });
    } else {
      this.createBlockAndProposal()
        .then(({ block, proposal }) => {
          this._newMessage({
            msg: new ProposalMessage(proposal),
            peerId: ''
          });
          this._newMessage({
            msg: new ProposalBlockMessage(block),
            peerId: ''
          });
        })
        .catch((err) => {
          logger.error('StateMachine::decideProposal, catch error:', err);
        });
    }
  }

  private signVote(type: VoteType, hash: Buffer) {
    console.log('enter signVote, (t, hash)', type, hash.toString('hex'));
    if (!this.signer) {
      console.log('empty signer');
      return;
    }

    const index = this.validators.getIndexByAddress(this.signer.address());
    if (index === undefined) {
      console.log('empty index');
      return;
    }

    const vote = new Vote({
      chainId: this.node.getChainId(),
      type,
      height: this.height,
      round: this.round,
      timestamp: 1,
      hash,
      index
    });
    vote.signature = this.signer.sign(vote.getMessageToSign());
    this._newMessage({
      msg: new VoteMessage(vote),
      peerId: ''
    });
    return vote;
  }

  private enterPropose(height: BN, round: number) {
    console.log('enter enterPropose');

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Propose <= this.step)) {
      logger.debug('StateMachine::enterProposal, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    const update = () => {
      this.round = round;
      this.step = RoundStepType.Propose;
      this.newStep();

      if (this.isProposalComplete()) {
        this.enterPrevote(height, round);
      }
    };

    this.timeoutTicker.schedule({
      duration: proposeDuration(round),
      step: RoundStepType.Propose,
      height: height.clone(),
      round
    });

    if (!this.signer) {
      console.log('empty signer');
      return update();
    }

    if (!this.validators.proposer.equals(this.signer.address())) {
      console.log('proposer no equal');
      return update();
    }

    this.decideProposal(height, round);
    return update();
  }

  private enterPrevote(height: BN, round: number) {
    console.log('enter enterPrevote');

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Prevote <= this.step)) {
      logger.debug('StateMachine::enterPrevote, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    const update = () => {
      this.round = round;
      this.step = RoundStepType.Prevote;
      this.newStep();
    };

    if (this.lockedBlock) {
      this.signVote(VoteType.Prevote, this.lockedBlock.hash());
      return update();
    }

    if (this.proposalBlock === undefined) {
      this.signVote(VoteType.Prevote, EMPTY_HASH);
      return update();
    }

    // TODO: validate block
    const validate = 1;
    if (validate) {
      this.signVote(VoteType.Prevote, this.proposalBlock.hash());
    } else {
      this.signVote(VoteType.Prevote, EMPTY_HASH);
    }
    return update();
  }

  private enterPrevoteWait(height: BN, round: number) {
    console.log('enter enterPrevoteWait');

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.PrevoteWait <= this.step)) {
      logger.debug('StateMachine::enterPrevoteWait, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    if (!this.votes.prevotes(round)?.hasTwoThirdsAny()) {
      throw new Error("enterPrevoteWait doesn't have any +2/3 votes");
    }

    const update = () => {
      this.round = round;
      this.step = RoundStepType.PrevoteWait;
      this.newStep();
    };

    this.timeoutTicker.schedule({
      duration: prevoteDuration(round),
      step: RoundStepType.PrevoteWait,
      height: height.clone(),
      round
    });
    return update();
  }

  private enterPrecommit(height: BN, round: number) {
    console.log('enter enterPrecommit');

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Precommit <= this.step)) {
      logger.debug('StateMachine::enterPrecommit, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    const update = () => {
      this.round = round;
      this.step = RoundStepType.Precommit;
      this.newStep();
    };

    const maj23Hash = this.votes.prevotes(round)?.maj23;

    if (!maj23Hash) {
      this.signVote(VoteType.Precommit, EMPTY_HASH);
      return update();
    }

    const polInfo = this.votes.POLInfo();
    if (polInfo && polInfo[0] < round) {
      throw new Error('invalid pol round');
    }

    if (isEmptyHash(maj23Hash)) {
      if (this.lockedBlock === undefined) {
        // do nothing
      } else {
        this.lockedRound = -1;
        this.lockedBlock = undefined;
      }

      this.signVote(VoteType.Precommit, EMPTY_HASH);
      return update();
    }

    if (this.lockedBlock && this.lockedBlock.hash().equals(maj23Hash)) {
      this.lockedRound = round;

      this.signVote(VoteType.Precommit, maj23Hash);
      return update();
    }

    if (this.proposalBlock && this.proposalBlock.hash().equals(maj23Hash)) {
      // validate block

      this.lockedRound = round;
      this.lockedBlock = this.proposalBlock;

      this.signVote(VoteType.Precommit, maj23Hash);
      return update();
    }

    this.lockedRound = -1;
    this.lockedBlock = undefined;

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalBlockHash = maj23Hash;
    }

    this.signVote(VoteType.Precommit, EMPTY_HASH);
    return update();
  }

  private enterPrecommitWait(height: BN, round: number) {
    console.log('enter enterPrecommitWait');

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.triggeredTimeoutPrecommit)) {
      logger.debug('StateMachine::enterPrecommitWait, invalid args', height.toNumber(), round, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    if (!this.votes.precommits(round)?.hasTwoThirdsAny()) {
      throw new Error("enterPrecommitWait doesn't have any +2/3 votes");
    }

    const update = () => {
      this.triggeredTimeoutPrecommit = true;
      this.newStep();
    };

    this.timeoutTicker.schedule({
      duration: precommitDutaion(round),
      step: RoundStepType.PrecommitWait,
      height: height.clone(),
      round
    });
    return update();
  }

  private enterCommit(height: BN, commitRound: number) {
    console.log('enter enterCommit');

    if (!this.height.eq(height) || RoundStepType.Commit <= this.step) {
      logger.debug('StateMachine::enterCommit, invalid args', height.toNumber(), commitRound, 'local:', this.height.toNumber(), this.round, this.step);
      return;
    }

    const update = () => {
      this.step = RoundStepType.Commit;
      this.commitRound = commitRound;
      this.commitTime = Date.now();
      this.newStep();

      this.tryFinalizeCommit(height);
    };

    const maj23Hash = this.votes.precommits(commitRound)?.maj23;
    if (!maj23Hash) {
      throw new Error('enterCommit expected +2/3 precommits');
    }
    if (this.lockedBlock) {
      const lockedHash = this.lockedBlock.hash();
      if (lockedHash.equals(maj23Hash)) {
        this.proposalBlockHash = this.lockedBlock.hash();
        this.proposalBlock = this.lockedBlock;
      }
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalBlockHash = maj23Hash;
    }

    return update();
  }

  private tryFinalizeCommit(height: BN) {
    console.log('enter tryFinalizeCommit');

    if (!this.height.eq(height) || this.step !== RoundStepType.Commit) {
      throw new Error('tryFinalizeCommit invalid args');
    }

    const precommits = this.votes.precommits(this.commitRound);
    const maj23Hash = precommits?.maj23;
    if (!precommits || !maj23Hash || isEmptyHash(maj23Hash)) {
      console.log('empty maj23');
      return;
    }

    if (!this.proposal || !this.proposal.hash.equals(maj23Hash)) {
      console.log('empty proposal');
      return;
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      console.log('empty proposalBlock');
      return;
    }

    // TODO: validate proposalBlock
    // TODO: save seenCommit

    const finalizedBlock = this.reimint.generateFinalizedBlock({ ...this.proposalBlock.header }, [...this.proposalBlock.transactions], this.proposal, precommits, { common: this.proposalBlock._common });
    if (!finalizedBlock.hash().equals(maj23Hash)) {
      logger.error('StateMachine::tryFinalizeCommit, finalizedBlock hash not equal, something is wrong');
      return;
    }

    this.node
      .processBlock(finalizedBlock, { broadcast: true })
      .then((reorged) => {
        logger.debug('StateMachine::tryFinalizeCommit, mint a block');
        if (reorged) {
          // try to continue minting
          this.node.onMintBlock();
        }
      })
      .catch((err) => {
        logger.error('StateMachine::tryFinalizeCommit, catch error:', err);
      });
  }

  //////////////////////////////////////

  get started() {
    return !!this.msgLoopPromise;
  }

  start() {
    if (this.msgLoopPromise) {
      throw new Error('msg loop has started');
    }
    this.msgLoopPromise = this.msgLoop();
  }

  async abort() {
    if (this.msgLoopPromise) {
      this.msgQueue.abort();
      await this.msgLoopPromise;
      this.msgQueue.reset();
      this.msgLoopPromise = undefined;
    }
  }

  private _newMessage(smsg: StateMachineMessage) {
    this.msgQueue.push(smsg);
  }

  newBlockHeader(header: BlockHeader, validators: ValidatorSet, pendingBlock: PendingBlock) {
    console.log('newBlockHeader', header.number.toNumber());
    // TODO: pretty this
    if (this.commitRound > -1 && this.height.gtn(0) && !this.height.eq(header.number)) {
      throw new Error('newBlockHeader invalid args');
    }

    const timestamp = Date.now();
    this.parentHash = header.hash();
    this.height = header.number.addn(1);
    this.round = 0;
    this.step = RoundStepType.NewHeight;
    this.startTime = commitTimeout(this.commitTime ?? timestamp);
    console.log('startTime:', this.startTime);
    this.validators = validators;
    this.proposal = undefined;
    this.proposalBlock = undefined;
    this.pendingBlock = pendingBlock;
    this.lockedRound = -1;
    this.lockedBlock = undefined;
    this.validRound = -1;
    this.validBlock = undefined;
    this.votes = new HeightVoteSet(this.node.getChainId(), this.height, this.validators);
    this.commitRound = -1;
    this.triggeredTimeoutPrecommit = false;

    this.newStep(timestamp);

    const duration = this.startTime - timestamp;
    console.log('duration:', duration);
    this.timeoutTicker.schedule({
      duration,
      step: RoundStepType.NewHeight,
      height: this.height.clone(),
      round: 0
    });
  }

  newMessage(peerId: string, msg: Message) {
    if (this.started) {
      this._newMessage({ msg, peerId });
    }
  }

  getProposalBlock(hash: Buffer) {
    if (this.proposalBlockHash && this.proposalBlockHash.equals(hash) && this.proposalBlock) {
      return this.proposalBlock;
    }
  }

  getValSetSize() {
    return this.validators.length;
  }

  setVoteMaj23(height: BN, round: number, type: VoteType, peerId: string, hash: Buffer) {
    if (height.eq(this.height)) {
      return;
    }

    this.votes.setPeerMaj23(round, type, peerId, hash);
  }

  genNewRoundStepMessage(timestamp?: number) {
    return this.startTime !== undefined ? new NewRoundStepMessage(this.height, this.round, this.step, (timestamp ?? Date.now()) - this.startTime, 0) : undefined;
  }

  genVoteSetBitsMessage(height: BN, round: number, type: VoteType, hash: Buffer) {
    if (height.eq(this.height)) {
      return;
    }

    if (type !== VoteType.Prevote && type !== VoteType.Precommit) {
      throw new Error('invalid vote type');
    }

    const bitArray = type === VoteType.Prevote ? this.votes.prevotes(round)?.bitArrayByBlockID(hash) : this.votes.precommits(round)?.bitArrayByBlockID(hash);
    if (!bitArray) {
      throw new Error('missing bit array');
    }

    return new VoteSetBitsMessage(height, round, type, hash, bitArray);
  }

  genProposalMessage(height: BN, round: number) {
    if (!height.eq(this.height) || round !== this.round) {
      return;
    }

    if (!this.proposal) {
      return;
    }

    // only gossip proposal after get the proposalBlock,
    // because the remote peer will request for the proposalBlock immediately
    // if he doesn't have proposalBlock
    if (!this.proposalBlock) {
      return;
    }

    return new ProposalMessage(this.proposal);
  }

  pickVoteSetToSend(height: BN, round: number, proposalPOLRound: number, step: RoundStepType) {
    if (!height.eq(this.height) || this.votes === undefined) {
      return;
    }

    if (step === RoundStepType.NewHeight) {
      // TODO: return this.lastCommit
      return;
    }

    if (step <= RoundStepType.Propose && round !== -1 && round <= this.round && proposalPOLRound !== -1) {
      return this.votes.prevotes(proposalPOLRound);
    }

    if (step <= RoundStepType.PrevoteWait && round !== -1 && round <= this.round) {
      return this.votes.prevotes(round);
    }

    if (step <= RoundStepType.PrecommitWait && round !== -1 && round <= this.round) {
      return this.votes.precommits(round);
    }

    if (round !== -1 && round <= this.round) {
      return this.votes.prevotes(round);
    }

    if (proposalPOLRound !== -1) {
      return this.votes.prevotes(proposalPOLRound);
    }
  }

  pickVoteSetFromDatabase(height: BN) {
    return !height.isZero() && this.height.gt(height);
  }
}
