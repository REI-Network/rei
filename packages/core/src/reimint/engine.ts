import path from 'path';
import { encode } from 'rlp';
import { Address, BN, BNLike, ecsign, intToBuffer, bufferToHex } from 'ethereumjs-util';
import { BaseTrie, SecureTrie as Trie } from '@rei-network/trie';
import { VM } from '@rei-network/vm';
import EVM from '@rei-network/vm/dist/evm/evm';
import TxContext from '@rei-network/vm/dist/evm/txContext';
import { Block, HeaderData, BlockHeader, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { genesisStateByName } from '@rei-network/common/dist/genesisStates';
import { logger, ignoreError, Channel } from '@rei-network/utils';
import { Node } from '../node';
import { StateManager } from '../stateManager';
import { ActiveValidatorSet, ValidatorSets } from './validatorSet';
import { isEmptyAddress, getGasLimitByCommon, EMPTY_ADDRESS } from '../utils';
import { isEnableFreeStaking, loadInitData, isEnableHardfork2, isEnableBetterPOS, isEnableDAO } from '../hardforks';
import { IProcessBlockResult } from './types';
import { Worker } from './worker';
import { StakeManager, Contract, Fee, FeePool, ValidatorBls } from './contracts';
import { StateMachine } from './state';
import { Evidence, EvidencePool, EvidenceDatabase } from './evpool';
import { Reimint } from './reimint';
import { WAL } from './wal';
import { ReimintExecutor } from './executor';
import { ExtraData } from './extraData';
import { EvidenceCollector } from './evidenceCollector';
import { SignatureType } from './vote';

export class SimpleNodeSigner {
  constructor(private readonly node: Node) {}

  /**
   * Get signer address
   */
  address(): Address {
    return this.node.reimint.coinbase;
  }

  /**
   * Check if the ECDSA private key is unlocked
   */
  ecdsaUnlocked(): boolean {
    const coinbase = this.node.reimint.coinbase;
    if (isEmptyAddress(coinbase)) {
      return false;
    }
    return this.node.accMngr.hasUnlockedAccount(coinbase);
  }

  /**
   * ECDSA sign message
   * @param msg - Message hash
   * @returns ECDSA signature
   */
  ecdsaSign(msg: Buffer): Buffer {
    const signature = ecsign(msg, this.node.accMngr.getPrivateKey(this.node.reimint.coinbase));
    return Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
  }

  /**
   * Get BLS public key
   * @returns Undefined if doesn't exsit
   */
  blsPublicKey(): Buffer | undefined {
    const pubKey = this.node.blsMngr.getPublicKey();
    if (!pubKey) {
      return pubKey;
    }
    return Buffer.from(pubKey.toBytes());
  }

  /**
   * BLS sign message
   * @param msg - Message hash
   * @returns BLS signature
   */
  blsSign(msg: Buffer): Buffer {
    return Buffer.from(this.node.blsMngr.signMessage(msg).toBytes());
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

export class SimpleBackend {
  constructor(private readonly engine: ReimintEngine) {}

  /**
   * Get common instance by number
   * @param num - Number
   */
  getCommon(num: BNLike) {
    return this.engine.node.getCommon(num);
  }

  /**
   * Pre process block, skip consensus validation,
   * ensure the state root is correct
   * @param block - Target block
   * @returns Pre process block result
   */
  preprocessBlock(block: Block) {
    return this.engine.executor.processBlock({ block, skipConsensusValidation: true });
  }

  /**
   * Commit single block
   * @param block - Block
   */
  async commitBlock(block: Block, result: IProcessBlockResult) {
    try {
      const reorged = await this.engine.node.commitBlock({
        receipts: result.receipts,
        block,
        broadcast: true
      });
      if (reorged) {
        logger.info('⛏️  Mint block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
        // try to continue minting
        this.engine.node.tryToMintNextBlock();
      }
    } catch (err: any) {
      if (err.message === 'committed' || err.message === 'aborted') {
        // ignore errors...
      } else {
        logger.error('ReimintConsensusEngine::commitBlock, catch error:', err);
      }
    }
  }
}

export interface ReimintEngineOptions {
  node: Node;
  coinbase?: Address;
}

export class ReimintEngine {
  readonly node: Node;
  readonly worker: Worker;
  readonly state: StateMachine;
  readonly config: SimpleConfig = new SimpleConfig();
  readonly signer: SimpleNodeSigner;
  readonly backend: SimpleBackend;
  readonly evpool: EvidencePool;
  readonly executor: ReimintExecutor;
  readonly validatorSets = new ValidatorSets();

  protected _coinbase: Address;

  protected msgLoopPromise?: Promise<void>;
  protected readonly msgQueue = new Channel<Block>({ max: 1 });

  collector?: EvidenceCollector;

  constructor(options: ReimintEngineOptions) {
    this.node = options.node;
    this._coinbase = options.coinbase ?? EMPTY_ADDRESS;
    this.worker = new Worker({ node: this.node, engine: this });
    this.signer = new SimpleNodeSigner(this.node);
    this.backend = new SimpleBackend(this);
    const db = new EvidenceDatabase(this.node.evidencedb);
    this.evpool = new EvidencePool({ backend: db });
    const wal = new WAL({ path: path.join(this.node.datadir, 'WAL') });
    this.state = new StateMachine(this.backend, this.node.consensus, this.evpool, wal, this.node.chainId, this.config, this.signer);
    this.executor = new ReimintExecutor(this.node, this);
  }

  /**
   * Get current coinbase address
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * Init engine
   */
  async init() {
    const block = this.node.getLatestBlock();

    await this.evpool.init(block.header.number);
    await this._tryToMintNextBlock(block);
    await this.state.init();

    // create the collector if necessary
    const initData = loadInitData(this.node.getLatestCommon());
    if (initData) {
      const { initHeight, initHashes } = initData;
      this.collector = new EvidenceCollector(initHeight, initHashes);
      await this.collector.init(block.header.number, async (height: BN) => {
        // load evidence from canonical header
        const header = await this.node.db.getCanonicalHeader(height);
        return ExtraData.fromBlockHeader(header).evidence.map((ev) => ev.hash());
      });
    }
  }

  private async msgLoop() {
    for await (const block of this.msgQueue) {
      try {
        await this._tryToMintNextBlock(block);
      } catch (err) {
        logger.error('BaseConsensusEngine::msgLoop, catch error:', err);
      }
    }
  }

  /**
   * Start working
   */
  start() {
    if (!this.msgLoopPromise) {
      this.msgLoopPromise = this.msgLoop();
      this.state.start();
    }
  }

  /**
   * Stop working
   */
  async abort() {
    if (this.msgLoopPromise) {
      this.msgQueue.abort();
      await this.msgLoopPromise;
      this.msgLoopPromise = undefined;
      await ignoreError(this.state.abort());
    }
  }

  /**
   * Try to mint a block after this block
   * @param block - New block
   */
  tryToMintNextBlock(block: Block) {
    this.msgQueue.push(block);
  }

  /**
   * Add pending transactions to worker
   * @param txs - Pending transactions
   */
  addTxs(txs: Map<Buffer, Transaction[]>) {
    return this.worker.addTxs(txs);
  }

  /**
   * Try to mint a block after this block
   * @param block - New block
   */
  protected async _tryToMintNextBlock(block: Block) {
    const header = block.header;

    // make sure the new block has not been processed
    if (!this.state.isNewBlockHeader(header)) {
      return;
    }

    // create a new pending block through worker
    const pendingBlock = await this.worker.createPendingBlock(header);

    const difficulty = new BN(1);
    const gasLimit = this.calcGasLimit(block.header);
    pendingBlock.complete(difficulty, gasLimit);

    const vm = await this.node.getVM(header.stateRoot, header._common);
    const sm = this.getStakeManager(vm, block, header._common);
    let valSet: ActiveValidatorSet;
    if (isEnableDAO(pendingBlock.common)) {
      valSet = await this.validatorSets.getActiveValSet(header.stateRoot, sm, this.getValidatorBls(vm, block, pendingBlock.common));
    } else {
      valSet = await this.validatorSets.getActiveValSet(header.stateRoot, sm);
    }

    await this.state.newBlockHeader(header, valSet, pendingBlock);
  }

  /**
   * Process the new block
   * @param block - New block
   */
  async newBlock(block: Block) {
    const extraData = ExtraData.fromBlockHeader(block.header);
    await this.evpool.update(extraData.evidence, block.header.number);
    // collect all the evidence if we haven't reached hardfork2
    if (!isEnableHardfork2(block.header._common)) {
      this.collector?.newBlockHeader(
        block.header.number,
        extraData.evidence.map((ev) => ev.hash())
      );
    }
  }

  // calculate the gas limit of next block
  private calcGasLimit(parent: BlockHeader) {
    return getGasLimitByCommon(this.node.getCommon(parent.number.addn(1)));
  }

  /**
   * Try to add pending evidence,
   * if the addition is successful, broadcast to all peers
   * @param evidence - Pending evidence
   */
  async addEvidence(evidence: Evidence) {
    if (await this.evpool.addEvidence(evidence)) {
      for (const handler of this.node.consensus.handlers) {
        handler.sendEvidence(evidence);
      }
    }
  }

  /**
   * Get stake manager contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @param common - Common instance
   * @returns Stake manager contract object
   */
  getStakeManager(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new StakeManager(evm, common ?? block._common);
  }

  /**
   * Get validator bls contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @param common - Common instance
   * @returns validator bls contract object
   */
  getValidatorBls(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new ValidatorBls(evm, common ?? block._common);
  }

  /**
   * Get fee pool contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @param common - Common instance
   * @returns Fee pool contract object
   */
  getFeePool(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new FeePool(evm, common ?? block._common);
  }

  /**
   * Read total amount in fee contract
   * @param root - Target state root
   * @param num - Block number or common instance
   * @returns Total amount
   */
  async getTotalAmount(root: Buffer, num: BNLike | Common) {
    const state = await this.node.getStateManager(root, num);
    return await Fee.getTotalAmount(state);
  }

  /**
   * Get miner address
   * @param block - Block or block header
   */
  getMiner(block: Block | BlockHeader) {
    return Reimint.getMiner(block);
  }

  /**
   * Generate genesis state
   */
  async generateGenesis() {
    const common = this.node.getCommon(0);
    const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
    const stateManager = new StateManager({ common, trie: new Trie(this.node.chaindb) });
    await stateManager.generateGenesis(genesisStateByName(this.node.chain));
    let root = await stateManager.getStateRoot();

    // deploy system contracts
    const vm = await this.node.getVM(root, common);
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), genesisBlock);
    await Contract.deployReimintContracts(evm, common);
    if (isEnableFreeStaking(common)) {
      await Contract.deployFreeStakingContracts(evm, common);
    }
    if (isEnableBetterPOS(common)) {
      await Contract.deployBetterPOSContracts(evm, common);
    }

    root = await vm.stateManager.getStateRoot();

    if (!root.equals(genesisBlock.header.stateRoot)) {
      logger.error('State root not equal', bufferToHex(root), bufferToHex(genesisBlock.header.stateRoot));
      throw new Error('state root not equal');
    }
  }

  /**
   * Create a simple signed block by data,
   * the header data can be incompleted,
   * because the block created is only to
   * ensure that the correct miner can be obtained during `processTx`
   * @param data - Header data
   * @param common - Common instance
   * @param transactions - List of transaction
   * @returns Block
   */
  generatePendingBlock(headerData: HeaderData, common: Common) {
    const signatureType = isEnableDAO(common) ? SignatureType.BLS : SignatureType.ECDSA;
    if ((signatureType === SignatureType.ECDSA && this.signer.ecdsaUnlocked()) || (signatureType === SignatureType.BLS && this.signer.blsPublicKey())) {
      const { block } = Reimint.generateBlockAndProposal(headerData, [], { common }, { signer: this.signer, signatureType });
      return block;
    }
    // return empty block
    const header = BlockHeader.fromHeaderData(headerData, { common });
    return new Block(header, [], undefined, { common });
  }

  /**
   * Generate receipt trie
   * @param transactions - Transactions
   * @param receipts - Receipts
   */
  async generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer> {
    const trie = new BaseTrie();
    for (let i = 0; i < receipts.length; i++) {
      await trie.put(encode(i), receipts[i].serialize());
    }
    return trie.root;
  }
}
