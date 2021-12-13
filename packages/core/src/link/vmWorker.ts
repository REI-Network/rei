import path from 'path';
import { LevelUp } from 'levelup';
import { Address, BN, BNLike, bufferToHex } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Blockchain } from '@rei-network/blockchain';
import { Common, getGenesisState } from '@rei-network/common';
import { Database, DBSaveTxLookup, DBSaveReceipts, createEncodingLevelDB } from '@rei-network/database';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { Block, CLIQUE_EXTRA_VANITY } from '@rei-network/structure';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { logger } from '@rei-network/utils';
import { StakeManager, Router, Contract } from '../contracts';
import { ValidatorSets } from '../staking';
import { ConsensusType } from '../consensus/types';
import { Evidence, ExtraData, EvidenceFactory } from '../consensus/reimint/types';
import { EMPTY_ADDRESS } from '../utils';
import { CliqueExecutor, ReimintExecutor } from '../executor';
import { isEnableStaking, getConsensusTypeByCommon } from '../hardforks';
import { WorkerSide } from './link';
import { Handler, RLPFinalizeOpts, RLPProcessBlockOpts, RLPProcessTxOpts, RLPCommitBlockOpts, RLPCommitBlockResult } from './types';
import { fromFinalizeResult, fromProcessBlockResult, fromProcessTxResult, toCommitBlockOpts, toFinalizeOpts, toProcessBlockOpts, toProcessTxOpts } from './utils';

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
    'commitBlock',
    async function (this: VMWorker, _opts: RLPCommitBlockOpts): Promise<RLPCommitBlockResult> {
      const opts = toCommitBlockOpts(_opts, this.common);
      const { block, receipts } = opts;

      const hash = block.hash();
      const number = block.header.number;

      // ensure that the block has not been executed
      try {
        await this.db.getHeader(hash, number);
        return { reorged: false };
      } catch (err: any) {
        if (err.type !== 'NotFoundError') {
          throw err;
        }
      }

      const before = this.blockchain.latestBlock.hash();

      // commit
      {
        // save block
        await this.blockchain.putBlock(block);
        // save receipts
        await this.db.batch(DBSaveTxLookup(block).concat(DBSaveReceipts(receipts, hash, number)));
      }

      logger.info('✨ Commit block, height:', number.toString(), 'hash:', bufferToHex(hash));

      const after = this.blockchain.latestBlock.hash();

      const reorged = !before.equals(after);

      return { reorged };
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
  ],
  [
    'latestBlock',
    async function (this: VMWorker, data: any) {
      const block = await this.blockchain.getLatestBlock();
      return block.serialize();
    }
  ],
  [
    'totalDifficulty',
    async function (this: VMWorker, { hash, number }: { hash: Buffer; number: Buffer }) {
      const td = await this.blockchain.getTotalDifficulty(hash, new BN(number));
      return td.toArrayLike(Buffer);
    }
  ],
  [
    'cliqueActiveSignersByBlockNumber',
    async function (this: VMWorker, { number }: { number: Buffer }) {
      const signers = this.blockchain.cliqueActiveSignersByBlockNumber(new BN(number));
      return signers.map((signer) => signer.buf);
    }
  ],
  [
    'cliqueCheckNextRecentlySigned',
    async function name(this: VMWorker, { number: _number, signer: _signer }: { number: Buffer; signer: Buffer }) {
      // TODO: fix this
      const number = new BN(_number);
      const signer = new Address(_signer);

      if (number.isZero()) {
        return false;
      }

      const limit: number = (this.blockchain as any).cliqueSignerLimit();
      let signers = (this as any)._cliqueLatestBlockSigners;
      signers = signers.slice(signers.length < limit ? 0 : 1);
      signers.push([number.addn(1), signer]);
      const seen = signers.filter((s) => s[1].equals(signer)).length;
      return seen > 1;
    }
  ],
  [
    'generateGenesis',
    async function (this: VMWorker, data: any) {
      const common = this.getCommon(0);
      const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
      const stateManager = new StateManager({ common, trie: new Trie(this.chaindb) });
      await stateManager.generateGenesis(getGenesisState(this.chain));
      let root = await stateManager.getStateRoot();

      // if it is mainnet or devnet, deploy system contract now
      if (this.chain === 'rei-devnet' || this.chain === 'rei-mainnet') {
        const vm = await this.getVM(root, common);
        const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), genesisBlock);
        await Contract.deploy(evm, common);
        root = await vm.stateManager.getStateRoot();
      }

      if (!root.equals(genesisBlock.header.stateRoot)) {
        logger.error('State root not equal', bufferToHex(root), bufferToHex(genesisBlock.header.stateRoot));
        throw new Error('state root not equal');
      }
    }
  ],
  [
    'init',
    async function (this: VMWorker, { path, chain }: { path: string; chain: string }) {
      await this.init(path, chain);
    }
  ],
  [
    'abort',
    async function (this: VMWorker, data: any) {
      await this.abort();
    }
  ]
]);

export class VMWorker extends WorkerSide {
  readonly validatorSets: ValidatorSets;
  readonly clique: CliqueExecutor;
  readonly reimint: ReimintExecutor;

  db!: Database;
  chain!: string;
  chaindb!: LevelUp;
  common!: Common;
  blockchain!: Blockchain;

  constructor() {
    super(vmHandlers);

    this.validatorSets = new ValidatorSets();
    this.clique = new CliqueExecutor(this);
    this.reimint = new ReimintExecutor(this);
  }

  async init(_path: string, chain: string) {
    this.common = Common.createCommonByBlockNumber(0, chain);
    this.chain = chain;
    this.chaindb = createEncodingLevelDB(path.join(_path, 'chaindb'));
    this.db = new Database(this.chaindb, this.common);

    const genesisBlock = Block.fromBlockData({ header: this.common.genesis() }, { common: this.common });
    this.blockchain = new Blockchain({
      dbManager: this.db,
      common: this.common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });
    await this.blockchain.init();
  }

  async abort() {
    await super.abort();
    await this.chaindb.close();
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
      stateManager: stateManager,
      blockchain: this.blockchain,
      getMiner: (header) => {
        const type = getConsensusTypeByCommon(header._common);
        if (type === ConsensusType.Clique) {
          return header.cliqueSigner();
        } else if (type === ConsensusType.Reimint) {
          if (header.extraData.length === CLIQUE_EXTRA_VANITY) {
            return EMPTY_ADDRESS;
          } else {
            return ExtraData.fromBlockHeader(header).proposal.proposer();
          }
        } else {
          throw new Error('unknown consensus type');
        }
      }
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

  async checkEvidence(evList: Evidence[]) {
    await this.request(
      'checkEvidence',
      evList.map((ev) => EvidenceFactory.serializeEvidence(ev))
    );
  }
}
