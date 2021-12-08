import crypto from 'crypto';
import { BN, bufferToHex } from 'ethereumjs-util';
import { Channel, logger } from '@gxchain2/utils';
import { Block, BlockHeader } from '@gxchain2/structure';
import { ValidatorSet } from '../../staking';
import { PendingBlock } from '../pendingBlock';
import { isEmptyHash, EMPTY_HASH } from '../../utils';
import { Reimint } from './reimint';
import {
  TimeoutTicker,
  StateMachineMessage,
  StateMachineTimeout,
  StateMachineEndHeight,
  StateMachineMsg,
  IProcessBlockResult,
  IStateMachineBackend,
  IStateMachineP2PBackend,
  ISigner,
  IConfig,
  IEvidencePool,
  IWAL,
  IDebug,
  RoundStepType,
  Message,
  NewRoundStepMessage,
  NewValidBlockMessage,
  VoteMessage,
  ProposalBlockMessage,
  GetProposalBlockMessage,
  ProposalMessage,
  HasVoteMessage,
  VoteSetBitsMessage,
  HeightVoteSet,
  Vote,
  VoteType,
  ConflictingVotesError,
  DuplicateVotesError,
  Proposal,
  Evidence,
  DuplicateVoteEvidence,
  ExtraData
} from './types';
import { preValidateBlock, preValidateHeader } from '../../validation';

const SkipTimeoutCommit = true;
const WaitForTxs = true;
const CreateEmptyBlocksInterval = 0;
const StateMachineMsgQueueMaxSize = 100;

export class StateMachine {
  private readonly chainId: number;
  private readonly timeoutTicker = new TimeoutTicker((ti) => {
    this._newMessage(ti);
  });

  private readonly backend: IStateMachineBackend;
  private readonly p2p: IStateMachineP2PBackend;
  private readonly signer?: ISigner;
  private readonly config: IConfig;
  private readonly evpool: IEvidencePool;
  private readonly wal: IWAL;
  private readonly debug?: IDebug;

  private msgLoopPromise?: Promise<void>;
  private readonly msgQueue = new Channel<StateMachineMsg>({
    max: StateMachineMsgQueueMaxSize,
    drop: (message) => {
      logger.warn('StateMachine::drop, too many messages, drop:', message);
    }
  });

  private parent!: BlockHeader;
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
  private proposalBlockResult?: IProcessBlockResult;

  private lockedRound: number = -1;
  private lockedBlock?: Block;
  private lockedEvidence?: Evidence[];
  private lockedBlockResult?: IProcessBlockResult;

  private validRound: number = -1;
  private validBlock?: Block;

  private votes!: HeightVoteSet;
  private commitRound: number = -1;
  /////////////// RoundState ///////////////

  constructor(backend: IStateMachineBackend, p2p: IStateMachineP2PBackend, evpool: IEvidencePool, wal: IWAL, chainId: number, config: IConfig, signer?: ISigner, debug?: IDebug) {
    this.backend = backend;
    this.p2p = p2p;
    this.chainId = chainId;
    this.evpool = evpool;
    this.wal = wal;
    this.config = config;
    this.signer = signer;
    this.debug = debug;
  }

  private newStep() {
    this.p2p.broadcastMessage(this.genNewRoundStepMessage()!, { broadcast: true });
  }

  async msgLoop() {
    // open WAL
    await this.wal.open();
    // replay from WAL files
    await this.replay();
    // message loop
    for await (const msg of this.msgQueue.generator()) {
      try {
        if (msg instanceof StateMachineMessage) {
          const internal = msg.peerId === '';
          const result = await this.wal.write(msg, internal);
          if (internal && !result) {
            throw new Error('internal message write failed');
          }

          await this.handleMsg(msg);
        } else if (msg instanceof StateMachineTimeout) {
          await this.wal.write(msg);
          await this.handleTimeout(msg);
        }
      } catch (err) {
        logger.error('State::msgLoop, catch error:', err);
      }
    }
    // close WAL
    await this.wal.close();
  }

  private async handleMsg(mi: StateMachineMessage) {
    const { msg, peerId } = mi;

    if (msg instanceof ProposalMessage) {
      this.setProposal(msg.proposal, peerId);
    } else if (msg instanceof ProposalBlockMessage) {
      await this.addProposalBlock(msg.toBlock({ common: this.backend.getCommon(0), hardforkByBlockNumber: true }));
    } else if (msg instanceof VoteMessage) {
      await this.tryAddVote(msg.vote, peerId);
    } else {
      throw new Error('unknown msg type');
    }
  }

  private async handleTimeout(ti: StateMachineTimeout) {
    if (!ti.height.eq(this.height) || ti.round < this.round || (ti.round === this.round && ti.step < this.step)) {
      logger.debug('StateMachine::handleTimeout, ignoring tock because we are ahead(h,r,s):', ti.height.toString(), ti.round, ti.step, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }
    // logger.debug('StateMachine::handleTimeout, timeout info:', ti);

    switch (ti.step) {
      case RoundStepType.NewHeight:
        await this.enterNewRound(ti.height, 0);
        break;
      case RoundStepType.NewRound:
        await this.enterPropose(ti.height, 0);
        break;
      case RoundStepType.Propose:
        await this.enterPrevote(ti.height, ti.round);
        break;
      case RoundStepType.PrevoteWait:
        this.enterPrecommit(ti.height, ti.round);
        break;
      case RoundStepType.PrecommitWait:
        this.enterPrecommit(ti.height, ti.round);
        await this.enterNewRound(ti.height, ti.round + 1);
        break;
      default:
        throw new Error('invalid timeout step');
    }
  }

  private setProposal(proposal: Proposal, peerId: string) {
    // logger.debug('StateMachine::setProposal');

    const requestProposalBlock = () => {
      if (this.proposalBlock === undefined && peerId !== '') {
        this.p2p.broadcastMessage(new GetProposalBlockMessage(proposal.hash), { to: peerId });
      }
    };

    if (this.proposal) {
      logger.debug('StateMachine::setProposal, proposal already exists');

      // if we still don’t have the proposal block, request the remote peer
      if (this.proposal.hash.equals(proposal.hash)) {
        requestProposalBlock();
      }
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
    requestProposalBlock();
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

  private async addProposalBlock(block: Block) {
    // logger.debug('StateMachine::addProposalBlock');
    if (this.proposalBlock) {
      logger.debug('StateMachine::setProposal, proposal block already exists');
      return;
    }

    if (this.proposal === undefined) {
      // logger.debug('StateMachine::setProposal, add proposal block when proposal is undefined');
      return;
    }

    if (this.proposalBlockHash === undefined) {
      // logger.debug('StateMachine::setProposal, add proposal block when hash is undefined');
      return;
    }

    const extraData = ExtraData.fromBlockHeader(block.header);
    const hash = extraData.proposal.hash;
    const proposer = extraData.proposal.proposer();
    const evidence = extraData.evidence;

    /**
     * NOTE: the block proposer may be different from this.proposal.proposer,
     *       we just make sure that the block proposer is one of the validators
     */
    // if (!this.proposal.proposer().equals(proposer) || extraData.round !== this.proposal.round || extraData.POLRound !== this.proposal.POLRound) {
    //   throw new Error('invalid proposal block');
    // }
    if (!this.validators.contains(proposer)) {
      throw new Error('invalid proposal block');
    }

    if (!this.proposalBlockHash.equals(hash)) {
      throw new Error('invalid proposal block');
    }

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
      await this.enterPrevote(this.height, this.round);
      if (maj23Hash) {
        this.enterPrecommit(this.height, this.round);
      }
    } else if (this.step === RoundStepType.Commit) {
      await this.finalizeCommit(this.height);
    }
  }

  private async addVote(vote: Vote, peerId: string) {
    // logger.debug('StateMachine::addVote, vote(h,r,h,t):', vote.height.toString(), vote.round, bufferToHex(vote.hash), vote.type, 'from:', peerId);

    if (!vote.height.eq(this.height)) {
      logger.debug('StateMachine::addVote, unequal height, ignore, height:', vote.height.toString(), 'local:', this.height.toString());
      return;
    }

    this.votes.addVote(vote, peerId);

    this.p2p.broadcastMessage(new HasVoteMessage(vote.height, vote.round, vote.type, vote.index), { exclude: [peerId] });

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
              this.lockedBlockResult = undefined;
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
                this.proposalBlockResult = undefined;
              }

              if (!this.proposalBlockHash || !this.proposalBlockHash.equals(maj23Hash)) {
                this.proposalBlockHash = maj23Hash;
              }

              this.p2p.broadcastMessage(new NewValidBlockMessage(this.height, this.round, this.proposalBlockHash, this.step === RoundStepType.Commit), { broadcast: true });
            }
          }

          if (this.round < vote.round && prevotes?.hasTwoThirdsAny()) {
            await this.enterNewRound(this.height, vote.round);
          } else if (this.round === vote.round && RoundStepType.Prevote <= this.step) {
            if (maj23Hash && (this.isProposalComplete() || isEmptyHash(maj23Hash))) {
              this.enterPrecommit(this.height, vote.round);
            } else if (prevotes?.hasTwoThirdsAny()) {
              this.enterPrevoteWait(this.height, vote.round);
            }
          } else if (this.proposal !== undefined && 0 <= this.proposal.POLRound && this.proposal.POLRound === vote.round) {
            if (this.isProposalComplete()) {
              await this.enterPrevote(this.height, this.round);
            }
          }
        }
        break;
      case VoteType.Precommit:
        {
          const precommits = this.votes.precommits(vote.round);
          const maj23Hash = precommits?.maj23;
          if (maj23Hash) {
            await this.enterNewRound(this.height, vote.round);
            this.enterPrecommit(this.height, vote.round);

            if (!isEmptyHash(maj23Hash)) {
              await this.enterCommit(this.height, vote.round);
              if (SkipTimeoutCommit) {
                await this.enterNewRound(this.height, 0);
              }
            } else {
              this.enterPrecommitWait(this.height, vote.round);
            }
          } else if (this.round <= vote.round && precommits?.hasTwoThirdsAny()) {
            await this.enterNewRound(this.height, vote.round);
            this.enterPrecommitWait(this.height, vote.round);
          }
        }
        break;
      default:
        throw new Error('unexpected vote type');
    }
  }

  private async tryAddVote(vote: Vote, peerId: string) {
    try {
      await this.addVote(vote, peerId);
    } catch (err) {
      if (err instanceof ConflictingVotesError) {
        // if (!this.signer) {
        //   return;
        // }

        const { voteA, voteB } = err;
        if (!this.debug?.conflictVotes && this.signer && vote.validator().equals(this.signer.address())) {
          // found conflicting vote from ourselves
          logger.warn('local conflicting(h,r,v,ha,hb):', voteA.height.toString(), voteA.round, voteA.validator().toString(), bufferToHex(voteA.hash), bufferToHex(voteB.hash));
          return;
        }

        logger.debug('StateMachine::tryAddVote, catch duplicate vote evidence(h,r,v,ha,hb):', voteA.height.toString(), voteA.round, voteA.validator().toString(), bufferToHex(voteA.hash), bufferToHex(voteB.hash));
        this.evpool.addEvidence(DuplicateVoteEvidence.fromVotes(voteA, voteB));
      } else if (err instanceof DuplicateVotesError) {
        logger.detail('StateMachine::tryAddVote, duplicate votes from:', peerId);
      } else {
        logger.warn('StateMachine::tryAddVote, catch error:', err);
      }
    }
  }

  private async enterNewRound(height: BN, round: number) {
    // logger.debug('StateMachine::enterNewRound, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.step !== RoundStepType.NewHeight)) {
      // logger.debug('StateMachine::enterNewRound, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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
      this.proposalBlockResult = undefined;
    }

    this.votes.setRound(round + 1);
    this.triggeredTimeoutPrecommit = false;

    const waitForTxs = WaitForTxs && round === 0;
    if (waitForTxs) {
      if (CreateEmptyBlocksInterval > 0) {
        this._schedule(CreateEmptyBlocksInterval, height, round, RoundStepType.NewRound);
      } else {
        await this.enterPropose(height, 0);
      }
    } else {
      await this.enterPropose(height, round);
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
    const blockData = await pendingBlock.finalize({ round, evidence });

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
      const proposal = new Proposal({
        type: VoteType.Proposal,
        height: this.validBlock.header.number,
        round,
        POLRound: this.validRound,
        hash: this.validBlock.hash()
      });
      proposal.signature = this.signer!.sign(proposal.getMessageToSign());

      this._newMessage(new StateMachineMessage('', new ProposalMessage(proposal)));
      this._newMessage(new StateMachineMessage('', new ProposalBlockMessage(this.validBlock)));
    } else {
      this.createBlockAndProposal()
        .then(({ block, proposal }) => {
          this._newMessage(new StateMachineMessage('', new ProposalMessage(proposal)));
          this._newMessage(new StateMachineMessage('', new ProposalBlockMessage(block)));
        })
        .catch((err) => {
          logger.error('StateMachine::decideProposal, catch error:', err);
        });
    }
  }

  private signVote(type: VoteType, hash: Buffer) {
    // logger.debug('StateMachine::signVote, type:', type, 'hash:', bufferToHex(hash));
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
      hash,
      index
    });
    vote.signature = this.signer.sign(vote.getMessageToSign());
    this._newMessage(new StateMachineMessage('', new VoteMessage(vote)));

    if (this.debug?.conflictVotes) {
      const vote = new Vote({
        chainId: this.chainId,
        type,
        height: this.height,
        round: this.round,
        hash: crypto.randomBytes(32),
        index
      });
      vote.signature = this.signer.sign(vote.getMessageToSign());

      this._newMessage(new StateMachineMessage('', new VoteMessage(vote)));
    }
  }

  private async enterPropose(height: BN, round: number) {
    // logger.debug('StateMachine::enterPropose, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Propose <= this.step)) {
      // logger.debug('StateMachine::enterPropose, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }

    const update = async () => {
      this.round = round;
      this.step = RoundStepType.Propose;
      this.newStep();

      if (this.isProposalComplete()) {
        await this.enterPrevote(height, round);
      }
    };

    this._schedule(this.config.proposeDuration(round), height, round, RoundStepType.Propose);

    if (!this.signer) {
      logger.debug('StateMachine::enterPropose, empty signer');
      return await update();
    }

    if (!this.validators.proposer.equals(this.signer.address())) {
      logger.debug('StateMachine::enterPropose, invalid proposer');
      return await update();
    }

    this.decideProposal(height, round);
    return await update();
  }

  private async enterPrevote(height: BN, round: number) {
    // logger.debug('StateMachine::enterPrevote, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Prevote <= this.step)) {
      // logger.debug('StateMachine::enterPrevote, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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

    let validateResult = false;
    try {
      preValidateHeader.call(this.proposalBlock.header, this.parent);
      await preValidateBlock.call(this.proposalBlock);
      this.proposalBlockResult = await this.backend.preProcessBlock(this.proposalBlock);
      validateResult = true;
    } catch (err) {
      logger.warn('StateMachine::enterPrevote, preValidateHeaderAndBlock or process block failed:', err);
    }

    if (validateResult) {
      this.signVote(VoteType.Prevote, this.proposalBlock.hash());
    } else {
      this.signVote(VoteType.Prevote, EMPTY_HASH);
    }
    return update();
  }

  private enterPrevoteWait(height: BN, round: number) {
    // logger.debug('StateMachine::enterPrevoteWait, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.PrevoteWait <= this.step)) {
      // logger.debug('StateMachine::enterPrevoteWait, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
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

    this._schedule(this.config.prevoteDuration(round), height, round, RoundStepType.PrevoteWait);
    return update();
  }

  private enterPrecommit(height: BN, round: number) {
    // logger.debug('StateMachine::enterPrecommit, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && RoundStepType.Precommit <= this.step)) {
      // logger.debug('StateMachine::enterPrecommit, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }

    const update = () => {
      this.round = round;
      this.step = RoundStepType.Precommit;
      this.newStep();
    };

    if (this.debug?.precommitForEmptyWhenFirstRound && round === 0) {
      this.signVote(VoteType.Precommit, EMPTY_HASH);
      return update();
    }

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
        this.lockedBlockResult = undefined;
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
      this.lockedRound = round;
      this.lockedBlock = this.proposalBlock;
      this.lockedEvidence = this.proposalEvidence;
      this.lockedBlockResult = this.proposalBlockResult;

      this.signVote(VoteType.Precommit, maj23Hash);
      return update();
    }

    this.lockedRound = -1;
    this.lockedBlock = undefined;
    this.lockedEvidence = undefined;
    this.lockedBlockResult = undefined;

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalEvidence = undefined;
      this.proposalBlockHash = maj23Hash;
      this.proposalBlockResult = undefined;
    }

    this.signVote(VoteType.Precommit, EMPTY_HASH);
    return update();
  }

  private enterPrecommitWait(height: BN, round: number) {
    // logger.debug('StateMachine::enterPrecommitWait, height:', height.toString(), 'round:', round);

    if (!this.height.eq(height) || round < this.round || (this.round === round && this.triggeredTimeoutPrecommit)) {
      // logger.debug('StateMachine::enterPrecommitWait, invalid args(h,r):', height.toString(), round, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }

    if (!this.votes.precommits(round)?.hasTwoThirdsAny()) {
      throw new Error("enterPrecommitWait doesn't have any +2/3 votes");
    }

    const update = () => {
      this.triggeredTimeoutPrecommit = true;
      this.newStep();
    };

    this._schedule(this.config.precommitDutaion(round), height, round, RoundStepType.PrecommitWait);
    return update();
  }

  private async enterCommit(height: BN, commitRound: number) {
    // logger.debug('StateMachine::enterCommit, height:', height.toString(), 'commitRound:', commitRound);

    if (!this.height.eq(height) || RoundStepType.Commit <= this.step) {
      // logger.debug('StateMachine::enterCommit, invalid args(h,r):', height.toString(), commitRound, 'local(h,r,s):', this.height.toString(), this.round, this.step);
      return;
    }

    const update = async () => {
      this.step = RoundStepType.Commit;
      this.commitRound = commitRound;
      this.commitTime = Date.now();
      this.newStep();

      await this.finalizeCommit(height);
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
        this.proposalBlockResult = this.lockedBlockResult;
      }
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      this.proposalBlock = undefined;
      this.proposalEvidence = undefined;
      this.proposalBlockHash = maj23Hash;
      this.proposalBlockResult = undefined;
    }

    return await update();
  }

  private async finalizeCommit(height: BN) {
    // logger.debug('StateMachine::tryFinalizeCommit, height:', height.toString());

    if (!this.height.eq(height) || this.step !== RoundStepType.Commit) {
      throw new Error('finalizeCommit invalid args');
    }

    if (this.commitRound === -1) {
      logger.debug('StateMachine::finalizeCommit, invalid commitRound');
      return;
    }

    const precommits = this.votes.precommits(this.commitRound);
    const maj23Hash = precommits?.maj23;
    if (!precommits || !maj23Hash || isEmptyHash(maj23Hash)) {
      logger.debug('StateMachine::finalizeCommit, empty maj23 hash');
      return;
    }

    if (!this.proposal || !this.proposal.hash.equals(maj23Hash)) {
      logger.debug('StateMachine::finalizeCommit, invalid proposal');
      return;
    }

    if (!this.proposalBlock || !this.proposalBlock.hash().equals(maj23Hash)) {
      logger.debug('StateMachine::finalizeCommit, invalid proposal block');
      return;
    }

    if (this.proposalEvidence === undefined || this.proposalBlockResult === undefined) {
      logger.debug('StateMachine::finalizeCommit, invalid proposal evidence or block result');
      return;
    }

    const extraData = ExtraData.fromBlockHeader(this.proposalBlock.header);
    const proposalInBlock = extraData.proposal;

    const finalizedBlock = Reimint.generateFinalizedBlock({ ...this.proposalBlock.header }, [...this.proposalBlock.transactions], [...this.proposalEvidence], proposalInBlock, this.commitRound, precommits, { common: this.proposalBlock._common });
    if (!finalizedBlock.hash().equals(maj23Hash)) {
      logger.error('StateMachine::finalizeCommit, finalizedBlock hash not equal, something is wrong');
      return;
    }

    const succeed = await this.wal.write(new StateMachineEndHeight(height), true);
    if (!succeed) {
      logger.error('StateMachine::finalizeCommit, write ahead log failed');
      return;
    }

    try {
      /**
       * NOTE: here, we will directly submit the block that has not executed `validateConsensus`,
       *       but it's ok, because the `precommits` already contains +2/3 pre-commit votes
       */
      await this.backend.commitBlock(finalizedBlock, this.proposalBlockResult);
    } catch (err) {
      logger.error('StateMachine::finalizeCommit, catch error:', err);
    }
  }

  //////////////////////////////////////

  private async replay() {
    if (this.height === undefined) {
      throw new Error('height is undefined');
    }

    logger.info('♻️  Start replay, local height:', this.height.subn(1).toString());

    const result = await this.wal.searchForLatestEndHeight();
    if (result === undefined) {
      logger.debug('StateMachine::replay, has nothing to replay');
      return;
    }

    const { reader, height: readerHeight } = result;
    if (readerHeight.gte(this.height)) {
      logger.debug('StateMachine::replay, future message');
      return;
    }

    try {
      let message: StateMachineMsg | undefined;
      while ((message = await reader.read())) {
        if (message instanceof StateMachineMessage) {
          const msg = message.msg;

          if (msg instanceof VoteMessage) {
            const vote = msg.vote;
            logger.debug('StateMachine::replay, vote, height:', vote.height.toString(), 'round:', vote.round, 'type:', vote.type, 'hash:', bufferToHex(vote.hash), 'validator:', vote.validator().toString(), 'from:', message.peerId);
          } else if (msg instanceof ProposalBlockMessage) {
            // create block instance from block buffer
            const block = msg.toBlock({ common: this.backend.getCommon(0), hardforkByBlockNumber: true });
            logger.debug('StateMachine::replay, block, height:', block.header.number.toString(), 'from:', (message as StateMachineMessage).peerId);
          } else if (msg instanceof ProposalMessage) {
            const proposal = msg.proposal;
            logger.debug('StateMachine::replay, proposal, height:', proposal.height.toString(), 'round:', proposal.round, 'hash:', bufferToHex(proposal.hash), 'proposer:', proposal.proposer().toString(), 'from:', message.peerId);
          } else {
            logger.warn('StateMachine::replay, something is wrong, invalid message:', message);
            continue;
          }

          await this.handleMsg(message as StateMachineMessage);
        } else if (message instanceof StateMachineTimeout) {
          logger.debug('StateMachine::replay, timeout, height:', message.height.toString(), 'round:', message.round, 'step:', message.step);
          await this.handleTimeout(message);
        } else if (message instanceof StateMachineEndHeight) {
          logger.warn('StateMachine::replay, something is wrong, read end height message of:', message.height.toString());
          continue;
        } else {
          logger.error('StateMachine::replay, unknown message:', message);
          continue;
        }
      }
      await reader.close();
    } catch (err: any) {
      await reader.close();
      // clear WAL files and reopen
      await this.wal.clear();
      await this.wal.open();
      logger.error('StateMachine::replay, catch error:', err);
    } finally {
      logger.info('♻️  Replay, over');
    }
  }

  //////////////////////////////////////
  get isStarted() {
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
      await this.wal.close();
    }
  }

  private _schedule(duration: number, height: BN, round: number, step: RoundStepType) {
    this.timeoutTicker.schedule(new StateMachineTimeout(duration, height, round, step));
  }

  private _newMessage(message: StateMachineMsg) {
    this.msgQueue.push(message);
  }

  isNewBlockHeader(header: BlockHeader) {
    if (this.parent && this.parent.hash().equals(header.hash())) {
      // ignore same header
      return false;
    }
    return true;
  }

  newBlockHeader(header: BlockHeader, validators: ValidatorSet, pendingBlock: PendingBlock) {
    const timestamp = Date.now();
    this.parent = header;
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
    this.proposalBlockResult = undefined;
    this.pendingBlock = pendingBlock;
    this.lockedRound = -1;
    this.lockedBlock = undefined;
    this.lockedEvidence = undefined;
    this.lockedBlockResult = undefined;
    this.validRound = -1;
    this.validBlock = undefined;
    this.votes = new HeightVoteSet(this.chainId, this.height, this.validators);
    this.commitRound = -1;
    this.triggeredTimeoutPrecommit = false;

    this.newStep();

    const duration = this.startTime - timestamp;
    this._schedule(duration, this.height, 0, RoundStepType.NewHeight);

    logger.debug('StateMachine::newBlockHeader, lastest height:', header.number.toString(), 'next round should start at:', this.startTime);
  }

  newMessage(peerId: string, msg: Message) {
    if (this.isStarted) {
      this._newMessage(new StateMachineMessage(peerId, msg));
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

  genNewRoundStepMessage() {
    return this.startTime !== undefined ? new NewRoundStepMessage(this.height, this.round, this.step) : undefined;
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
