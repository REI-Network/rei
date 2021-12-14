import path from 'path';
import { encode } from 'rlp';
import { Address, BN, BNLike, ecsign, intToBuffer, bufferToHex } from 'ethereumjs-util';
import { BaseTrie } from 'merkle-patricia-tree';
import { Block, HeaderData, BlockHeader, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { logger } from '@rei-network/utils';
import { Node } from '../../node';
import { isEmptyAddress, getGasLimitByCommon } from '../../utils';
import { getConsensusTypeByCommon } from '../../hardforks';
import { ConsensusEngine, ConsensusEngineOptions, ConsensusType } from '../types';
import { BaseConsensusEngine } from '../engine';
import { WAL, IProcessBlockResult } from './types';
import { StateMachine } from './state';
import { Reimint } from './reimint';

export class SimpleNodeSigner {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  address(): Address {
    return this.node.getCurrentEngine().coinbase;
  }

  sign(msg: Buffer): Buffer {
    const coinbase = this.node.getCurrentEngine().coinbase;
    if (isEmptyAddress(coinbase)) {
      throw new Error('empty coinbase');
    }
    const signature = ecsign(msg, this.node.accMngr.getPrivateKey(coinbase));
    return Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
  }
}

export class SimpleConfig {
  // TODO: config
  proposeDuration(round: number) {
    return 3000 + 500 * round;
  }

  prevoteDuration(round: number) {
    return 1000 + 500 * round;
  }

  precommitDutaion(round: number) {
    return 1000 + 500 * round;
  }
}

export class ReimintConsensusEngine extends BaseConsensusEngine implements ConsensusEngine {
  readonly state: StateMachine;
  readonly config: SimpleConfig = new SimpleConfig();
  readonly signer: SimpleNodeSigner;

  constructor(options: ConsensusEngineOptions) {
    super(options);
    this.signer = new SimpleNodeSigner(this.node);
    this.state = new StateMachine(this, this.node.consensus, this.node.evpool, new WAL({ path: path.join(options.node.datadir, 'WAL') }), this.node.getChainId(), this.config, this.signer);
  }

  protected _start() {
    logger.debug('ReimintConsensusEngine::_start');
  }

  protected async _abort() {
    await this.state.abort();
  }

  /**
   * Process a new block, try to mint a block after this block
   * @param block - New block
   */
  protected async _newBlock(block: Block) {
    const header = block.header;

    // make sure the new block has not been processed
    if (!this.state.isNewBlockHeader(header)) {
      return;
    }

    // create a new pending block through worker
    const pendingBlock = await this.worker.createPendingBlock(header);
    if (!this.enable) {
      return;
    }

    const difficulty = new BN(1);
    const gasLimit = this.calcGasLimit(block.header);
    pendingBlock.complete(difficulty, gasLimit);

    let validators = this.node.validatorSets.directlyGet(header.stateRoot);
    // if the validator set doesn't exist, load from state trie
    if (!validators) {
      const vm = await this.node.getVM(header.stateRoot, header._common);
      const nextCommon = this.node.getCommon(block.header.number.addn(1));
      const sm = this.node.getStakeManager(vm, block, nextCommon);
      validators = await this.node.validatorSets.get(header.stateRoot, sm);
    }

    this.state.newBlockHeader(header, validators, pendingBlock);
    if (!this.state.isStarted) {
      this.state.start();
    }
  }

  // calculate the gas limit of next block
  private calcGasLimit(parent: BlockHeader) {
    const nextCommon = this.node.getCommon(parent.number.addn(1));
    if (getConsensusTypeByCommon(parent._common) === ConsensusType.Clique) {
      return getGasLimitByCommon(nextCommon);
    } else {
      return Reimint.calcGasLimit(parent.gasLimit, parent.gasUsed);
    }
  }

  /**
   * {@link ConsensusEngine.generatePendingBlock}
   */
  generatePendingBlock(headerData: HeaderData, common: Common) {
    const { block } = Reimint.generateBlockAndProposal(headerData, [], { common, signer: this.node.accMngr.hasUnlockedAccount(this.signer.address()) ? this.signer : undefined });
    return block;
  }

  /**
   * {@link ConsensusEngine.generateReceiptTrie}
   */
  async generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer> {
    const trie = new BaseTrie();
    for (let i = 0; i < receipts.length; i++) {
      await trie.put(encode(i), receipts[i].serialize());
    }
    return trie.root;
  }

  ///////////// Backend Logic ////////////////

  /**
   * Get common instance by number
   * @param num - Number
   */
  getCommon(num: BNLike) {
    return this.node.getCommon(num);
  }

  /**
   * Pre process block, skip consensus validation,
   * ensure the state root is correct
   * @param block - Target block
   * @returns Pre process block result
   */
  preProcessBlock(block: Block) {
    return this.node.master.processBlock({ block, skipConsensusValidation: true });
  }

  /**
   * Commit single block
   * @param block - Block
   */
  async commitBlock(block: Block, result: IProcessBlockResult) {
    const reorged = await this.node.commitBlock({
      ...result,
      block,
      broadcast: true
    });
    if (reorged) {
      logger.info('⛏️  Mine block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
      // try to continue minting
      this.node.onMintBlock();
    }
  }

  ///////////// Backend Logic ////////////////
}