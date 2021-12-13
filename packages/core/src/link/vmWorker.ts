import { LevelUp } from 'levelup';
import { BN, BNLike } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Blockchain } from '@rei-network/blockchain';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { Block } from '@rei-network/structure';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { StakeManager, Router } from '../contracts';
import { ValidatorSets } from '../staking';
import { EvidencePool, EvidenceDatabase } from '../consensus/reimint/types';
import { EMPTY_ADDRESS } from '../utils';
import { CliqueExecutor, ReimintExecutor } from '../executor';
import { isEnableStaking } from '../hardforks';
import { WorkerSide } from './link';
import { Handler, RLPFinalizeOpts, RLPProcessBlockOpts, RLPProcessTxOpts } from './types';
import { fromFinalizeResult, fromProcessBlockResult, fromProcessTxResult, toFinalizeOpts, toProcessBlockOpts, toProcessTxOpts } from './utils';

const vmHandlers = new Map<string, Handler>([
  [
    'finalize',
    async function (this: VMWorker, _opts: RLPFinalizeOpts) {
      const opts = toFinalizeOpts(_opts, this.common);
      const result = await this.getExecutor(opts.block._common).finalize(opts);
      if (result.validatorSet) {
        this.validatorSets.set(result.finalizedStateRoot, result.validatorSet);
      }
      return fromFinalizeResult(result);
    }
  ],
  [
    'processBlock',
    async function (this: VMWorker, _opts: RLPProcessBlockOpts) {
      const opts = toProcessBlockOpts(_opts, this.common);
      const result = await this.getExecutor(opts.block._common).processBlock(opts);
      if (result.validatorSet) {
        this.validatorSets.set(opts.block.header.stateRoot, result.validatorSet);
      }
      return fromProcessBlockResult(result);
    }
  ],
  [
    'processTx',
    async function (this: VMWorker, _opts: RLPProcessTxOpts) {
      const opts = toProcessTxOpts(_opts, this.common);
      const result = await this.getExecutor(opts.block._common).processTx(opts);
      return fromProcessTxResult(result);
    }
  ],
  [
    'put',
    function (this: VMWorker, data: any) {
      return this.callLevelDB('put', data);
    }
  ],
  [
    'get',
    function (this: VMWorker, data: any) {
      return this.callLevelDB('get', data);
    }
  ],
  [
    'del',
    function (this: VMWorker, data: any) {
      return this.callLevelDB('del', data);
    }
  ],
  [
    'batch',
    function (this: VMWorker, data: any) {
      return this.callLevelDB('batch', data);
    }
  ]
]);

export class VMWorker extends WorkerSide {
  readonly chaindb: LevelUp;
  readonly evidencedb: LevelUp;
  readonly common: Common;

  readonly db: Database;
  readonly blockchain: Blockchain;
  readonly validatorSets: ValidatorSets;
  readonly evpool: EvidencePool;

  readonly clique: CliqueExecutor;
  readonly reimint: ReimintExecutor;

  constructor(chaindb: LevelUp, evidencedb: LevelUp, common: Common) {
    super(vmHandlers);
    this.chaindb = chaindb;
    this.evidencedb = evidencedb;
    this.common = common;

    this.validatorSets = new ValidatorSets();
    this.db = new Database(chaindb, common);
    this.evpool = new EvidencePool({ backend: new EvidenceDatabase(evidencedb) });

    this.clique = new CliqueExecutor(this);
    this.reimint = new ReimintExecutor(this);

    const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
    this.blockchain = new Blockchain({
      dbManager: this.db,
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });
  }

  async init() {
    await this.blockchain.init();
    await this.evpool.start(this.blockchain.latestBlock.header.number);
  }

  callLevelDB(method: string, data: any) {
    return (this.chaindb as any)[method].apply(this.chaindb, data);
  }

  getExecutor(common: Common) {
    return isEnableStaking(common) ? this.reimint : this.clique;
  }

  getCommon(num: BNLike) {
    const common = this.common.copy();
    common.setHardforkByBlockNumber(num);
    return common;
  }

  async getStateManager(root: Buffer, num: BNLike | Common) {
    let common: Common;
    if (num instanceof Common) {
      common = num.copy();
    } else {
      common = this.common.copy();
      common.setHardforkByBlockNumber(num);
    }

    const stateManager = new StateManager({
      common,
      trie: new Trie(this.chaindb)
    });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  async getVM(root: Buffer, num: BNLike | Common) {
    const stateManager = root instanceof Buffer ? await this.getStateManager(root, num) : root;
    return new VM({
      listenHardforkChanged: false,
      hardforkByBlockNumber: true,
      common: stateManager._common,
      stateManager: stateManager
    });
  }

  getStakeManager(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new StakeManager(evm, common ?? block._common);
  }

  getRouter(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new Router(evm, common ?? block._common);
  }
}
