import { BN, bufferToHex } from 'ethereumjs-util';
import { Channel, logger } from '@gxchain2/utils';
import { Block, BlockHeader } from '@gxchain2/structure';
import { ValidatorSet } from '../../../staking';
import { PendingBlock } from '../../pendingBlock';
import { HeightVoteSet, Vote, VoteType, ConflictingVotesError, DuplicateVotesError, Proposal, Evidence, DuplicateVoteEvidence, ExtraData } from '../types';
import { Message, NewRoundStepMessage, NewValidBlockMessage, VoteMessage, ProposalBlockMessage, GetProposalBlockMessage, ProposalMessage, HasVoteMessage, VoteSetBitsMessage } from '../types/messages';
import { isEmptyHash, EMPTY_HASH } from '../../utils';
import { Reimint } from '../reimint';
import { TimeoutTicker } from './timeoutTicker';
import { StateMachineMessage, MessageInfo, StateMachineBackend, Signer, Config, EvidencePool, RoundStepType, TimeoutInfo } from './types';

const SkipTimeoutCommit = true;
const WaitForTxs = true;
const CreateEmptyBlocksInterval = 0;
const StateMachineMsgQueueMaxSize = 10;

function isMessageInfo(smsg: StateMachineMessage): smsg is MessageInfo {
  return 'peerId' in smsg;
}

export class StateMachine {
  private readonly chainId: number;
  private readonly backend: StateMachineBackend;
  // TODO:
  private readonly signer?: Signer;
  private readonly config: Config;
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

  private parentHash!: Buffer;
  private triggeredTimeoutPrecommit: boolean = false;

  /////////////// RoundState ///////////////
  private height: BN = new BN(0);
  private round: number = 0;
  private step: RoundStepType = RoundStepType.NewHeight;
  private startTime!: number;

  private commitTime?: number;
  private validators!: ValidatorSet;
  private pendingBlock?: PendingBlock;

  private proposal?: Proposal;
  private proposalBlockHash?: Buffer;
  private proposalBlock?: Block;
  private proposalEvidence?: Evidence[];

  private lockedRound: number = -1;
  private lockedBlock?: Block;
  private lockedEvidence?: Evidence[];

  private validRound: number = -1;
  private validBlock?: Block;

  private votes!: HeightVoteSet;
  private commitRound: number = -1;
  /////////////// RoundState ///////////////

  constructor(backend: StateMachineBackend, evpool: EvidencePool, chainId: number, config: Config, signer?: Signer) {
    this.backend = backend;
    this.chainId = chainId;
    this.evpool = evpool;
    this.config = config;
    this.signer = signer;
  }

  private newStep(timestamp?: number) {
    this.backend.broadcastMessage(this.genNewRoundStepMessage(timestamp)!, { broadcast: true });
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
    if (!ti.height.eq(this.height) || ti.round < this.round || (ti.round === this.round && ti.step < this.step)) {
      logger.debug('StateMachine::handleTimeout, ignoring tock because we are ahead:', ti, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }
    logger.debug('StateMachine::handleTimeout, timeout info:', ti);

    switch (ti.step) {
      case RoundStepType.NewHeight:
        this.enterNewRound(ti.height, 0);
        break;
      case RoundStepType.NewRound:
        this.enterPropose(ti.height, 0);
        break;
      case RoundStepType.Propose:
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

  private setProposal(proposal: Proposal, peerId: string) {
    logger.debug('StateMachine::setProposal');
    if (this.proposal) {
      logger.debug('StateMachine::setProposal, proposal already exists');
      return;
    }

    if (!this.height.eq(proposal.height) || this.round !== proposal.round) {
      logger.debug('StateMachine::setProposal, invalid proposal(h,r):', proposal.height.toString(), proposal.round, 'local(h,r):', this.height.toString(), this.round);
      return;
    }

    if (proposal.POLRound < -1 || (proposal.POLRound >= 0 && proposal.POLRound >= proposal.round)) {
      throw new Error('invalid proposal POL round');
    }

    proposal.validateSignature(this.validators.proposer);

    this.proposal = proposal;
    this.proposalBlockHash = proposal.hash;
    if (this.proposalBlock === undefined && peerId !== '') {
      this.backend.broadcastMessage(new GetProposalBlockMessage(proposal.hash), { to: peerId });
    }
  }

  private isProposalComplete() {
    if (this.proposal === undefined || this.proposalBlock === undefined || this.proposalEvidence === undefined) {
      return false;
    }

    if (this.proposal.POLRound < 0) {
      return true;
    }

    return !!this.votes.prevotes(this.proposal.POLRound)?.hasTwoThirdsMajority();
  }

  private addProposalBlock(block: Block) {
    logger.debug('StateMachine::addProposalBlock');
    if (this.proposalBlock) {
      logger.debug('StateMachine::setProposal, proposal block already exists');
      return;
    }

    if (this.proposal === undefined) {
      throw new Error('add proposal block when proposal is undefined');
    }

    if (this.proposalBlockHash === undefined) {
      throw new Error('add proposal block when hash is undefined');
    }

    const extraData = ExtraData.fromBlockHeader(block.header);
    const hash = extraData.proposal.hash;
    const proposer = extraData.proposal.proposer();
    const evidence = extraData.evidence;

    if (!this.proposal.proposer().equals(proposer)) {
      throw new Error('invalid proposal block');
    }

    if (!this.proposalBlockHash.equals(hash)) {
      throw new Error('invalid proposal block');
    }

    // TODO: validate block?
    this.proposalBlock = block;
    this.proposalEvidence = evidence;

    const prevotes = this.votes.prevotes(this.round);
    const maj23Hash = prevotes?.maj23;
    if (maj23Hash && !isEmptyHash(maj23Hash) && this.validRound < this.round) {
      if (this.proposalBlockHash.equals(maj23Hash)) {
        this.validRound = this.round;
        this.validBlock = this.proposalBlock;
        logger.debug('StateMachine::addProposalBlock, update valid block, round:', this.round, 'hash:', bufferToHex(maj23Hash));
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
    logger.debug('StateMachine::addVote, vote(h,r,h,t):', vote.height.toString(), vote.round, bufferToHex(vote.hash), vote.type, 'from:', peerId);

    if (!vote.height.eq(vote.height)) {
      logger.debug('StateMachine::addVote, unequal height, ignore, height:', vote.height.toString(), 'local:', this.height.toString());
      return;
    }

    this.votes.addVote(vote, peerId);
    // TODO: if add failed, return

    this.backend.broadcastMessage(new HasVoteMessage(vote.height, vote.round, vote.type, vote.index), { exclude: [peerId] });

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
              this.lockedEvidence = undefined;
            }

            // try to update valid block
            if (!isEmptyHash(maj23Hash) && this.validRound < vote.round && vote.round === this.round) {
              if (this.proposalBlockHash && this.proposalBlockHash.equals(maj23Hash)) {
                logger.debug('StateMachine::addVote, update valid block, round:', this.round, 'hash:', bufferToHex(maj23Hash));

                this.validRound = vote.round;
                this.validBlock = this.proposalBlock;
              } else {
                this.proposalBlock = undefined;
                this.proposalEvidence = undefined;
              }

              if (!this.proposalBlockHash || !this.proposalBlockHash.equals(maj23Hash)) {
                this.proposalBlockHash = maj23Hash;
              }

              this.backend.broadcastMessage(new NewValidBlockMessage(this.height, this.round, this.proposalBlockHash, this.step === RoundStepType.Commit), { broadcast: true });
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
        this.evpool.addEvidence(new DuplicateVoteEvidence(voteA, voteB, voteA.height));
      } else if (err instanceof DuplicateVotesError) {
        logger.detail('StateMachine::tryAddVote, duplicate votes from:', peerId);
      } else {
        logger.warn('StateMachine::tryAddVote, catch error:', err);
      }
    }
  }

  private enterNewRound(height: BN, round: number) {
    logger.debug('StateMachine::enterNewRound, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.step !== RoundStepType.NewHeight)) {
      logger.debug('StateMachine::enterNewRound, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
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
      this.proposalBlockHash = undefined;
      this.proposalBlock = undefined;
      this.proposalEvidence = undefined;
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

    const common = this.pendingBlock.common;
    const maxEvidenceCount = common.param('vm', 'maxEvidenceCount');
    if (typeof maxEvidenceCount !== 'number') {
      throw new Error('invalid maxEvidenceCount');
    }

    // save all parameters, because the parameters may change
    const round = this.round;
    const POLRound = this.validRound;
    const validatorSetSize = this.validators.length;
    const height = this.height.clone();
    const evpool = this.evpool;
    const pendingBlock = this.pendingBlock;
    const signer = this.signer!;

    const evidence = await evpool.pickEvidence(height, maxEvidenceCount);
    const blockData = await pendingBlock.finalize({ round });

    return Reimint.generateBlockAndProposal(blockData.header, blockData.transactions, {
      signer,
      round,
      POLRound,
      evidence,
      validatorSetSize,
      common
    });
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
    logger.debug('StateMachine::signVote, type:', type, 'hash:', bufferToHex(hash));
    if (!this.signer) {
      logger.debug('StateMachine::signVote, empty signer');
      return;
    }

    const index = this.validators.getIndexByAddress(this.signer.address());
    if (index === undefined) {
      logger.debug('StateMachine::signVote, undefined index');
      return;
    }

    const vote = new Vote({
      chainId: this.chainId,
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
    logger.debug('StateMachine::enterPropose, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Propose <= this.step)) {
      logger.debug('StateMachine::enterPropose, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
      duration: this.config.proposeDuration(round),
      step: RoundStepType.Propose,
      height: height.clone(),
      round
    });

    if (!this.signer) {
      logger.debug('StateMachine::enterPropose, empty signer');
      return update();
    }

    if (!this.validators.proposer.equals(this.signer.address())) {
      logger.debug('StateMachine::enterPropose, invalid proposer');
      return update();
    }

    this.decideProposal(height, round);
    return update();
  }

  private enterPrevote(height: BN, round: number) {
    logger.debug('StateMachine::enterPrevote, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Prevote <= this.step)) {
      logger.debug('StateMachine::enterPrevote, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
    logger.debug('StateMachine::enterPrevoteWait, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.PrevoteWait <= this.step)) {
      logger.debug('StateMachine::enterPrevoteWait, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
      duration: this.config.prevoteDuration(round),
      step: RoundStepType.PrevoteWait,
      height: height.clone(),
      round
    });
    return update();
  }

  private enterPrecommit(height: BN, round: number) {
    logger.debug('StateMachine::enterPrecommit, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Precommit <= this.step)) {
      logger.debug('StateMachine::enterPrecommit, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
        this.lockedEvidence = undefined;
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
      this.lockedEvidence = this.proposalEvidence;

      this.signVote(VoteType.Precommit, maj23Hash);
      return update();
    }

    this.lockedRound = -1;
    this.lockedBlock = undefined;
    this.lockedEvidence = undefined;

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalEvidence = undefined;
      this.proposalBlockHash = maj23Hash;
    }

    this.signVote(VoteType.Precommit, EMPTY_HASH);
    return update();
  }

  private enterPrecommitWait(height: BN, round: number) {
    logger.debug('StateMachine::enterPrecommitWait, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.triggeredTimeoutPrecommit)) {
      logger.debug('StateMachine::enterPrecommitWait, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
      duration: this.config.precommitDutaion(round),
      step: RoundStepType.PrecommitWait,
      height: height.clone(),
      round
    });
    return update();
  }

  private enterCommit(height: BN, commitRound: number) {
    logger.debug('StateMachine::enterCommit, height:', height.toString(), 'commitRound:', commitRound);

    if (!this.height.eq(height) || RoundStepType.Commit <= this.step) {
      logger.debug('StateMachine::enterCommit, invalid args(h,r):', height.toString(), commitRound, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
        this.proposalEvidence = this.lockedEvidence;
      }
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalEvidence = undefined;
      this.proposalBlockHash = maj23Hash;
    }

    return update();
  }

  private tryFinalizeCommit(height: BN) {
    logger.debug('StateMachine::tryFinalizeCommit, height:', height.toString());

    if (!this.height.eq(height) || this.step !== RoundStepType.Commit) {
      throw new Error('tryFinalizeCommit invalid args');
    }

    const precommits = this.votes.precommits(this.commitRound);
    const maj23Hash = precommits?.maj23;
    if (!precommits || !maj23Hash || isEmptyHash(maj23Hash)) {
      logger.debug('StateMachine::tryFinalizeCommit, empty maj23 hash');
      return;
    }

    if (!this.proposal || !this.proposal.hash.equals(maj23Hash)) {
      logger.debug('StateMachine::tryFinalizeCommit, invalid proposal');
      return;
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      logger.debug('StateMachine::tryFinalizeCommit, invalid proposal block');
      return;
    }

    if (this.proposalEvidence === undefined) {
      logger.debug('StateMachine::tryFinalizeCommit, invalid proposal evidence');
      return;
    }

    // TODO: validate proposalBlock

    const finalizedBlock = Reimint.generateFinalizedBlock({ ...this.proposalBlock.header }, [...this.proposalBlock.transactions], [...this.proposalEvidence], this.proposal, precommits, { common: this.proposalBlock._common });
    if (!finalizedBlock.hash().equals(maj23Hash)) {
      logger.error('StateMachine::tryFinalizeCommit, finalizedBlock hash not equal, something is wrong');
      return;
    }

    this.backend
      .executeBlock(finalizedBlock, { broadcast: true })
      .then(() => {
        logger.info('⛏️  Mine block, height:', finalizedBlock.header.number.toString(), 'hash:', bufferToHex(finalizedBlock.hash()));
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
    // TODO: pretty this
    // if (this.commitRound > -1 && this.height.gtn(0) && !this.height.eq(header.number)) {
    //   throw new Error('newBlockHeader invalid args');
    // }

    const timestamp = Date.now();
    this.parentHash = header.hash();
    this.height = header.number.addn(1);
    this.round = 0;
    this.step = RoundStepType.NewHeight;
    const pendingBlockTimestamp = pendingBlock.timestamp * 1e3;
    this.startTime = timestamp > pendingBlockTimestamp ? timestamp : pendingBlockTimestamp;
    this.validators = validators;
    this.proposal = undefined;
    this.proposalBlock = undefined;
    this.proposalEvidence = undefined;
    this.pendingBlock = pendingBlock;
    this.lockedRound = -1;
    this.lockedBlock = undefined;
    this.lockedEvidence = undefined;
    this.validRound = -1;
    this.validBlock = undefined;
    this.votes = new HeightVoteSet(this.chainId, this.height, this.validators);
    this.commitRound = -1;
    this.triggeredTimeoutPrecommit = false;

    this.newStep(timestamp);

    const duration = this.startTime - timestamp;
    this.timeoutTicker.schedule({
      duration,
      step: RoundStepType.NewHeight,
      height: this.height.clone(),
      round: 0
    });

    logger.debug('StateMachine::newBlockHeader, lastest height:', header.number.toString(), 'next round should start at:', this.startTime);
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

  hasMaj23Precommit(height: BN) {
    if (height.eq(this.height)) {
      const maj23 = this.votes.precommits(this.round)?.maj23;
      if (maj23 && !isEmptyHash(maj23)) {
        return true;
      }
    }
    return false;
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
}
