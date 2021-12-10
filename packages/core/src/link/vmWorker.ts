import { LevelUp } from 'levelup';
import { BN } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Common } from '@rei-network/common';
import VM from '@gxchain2-ethereumjs/vm';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { WorkerSide } from './link';
import { Handler, RunCallArgs, RunTxArgs, RunTxResult, RunCallResult } from './types';
import { toRunCallOpts, toRunTxOpts } from './utils';

const vmHandlers = new Map<string, Handler>([
  [
    'runTx',
    async function (this: VMWorker, args: RunTxArgs): Promise<RunTxResult> {
      const common = this.getCommon(args.number);
      const opts = toRunTxOpts(args, common);
      const vm = await this.getVM(args.root, common);
      const result = await vm.runTx(opts);
      return {
        createAddress: result.createdAddress && result.createdAddress.buf,
        succeed: !result.execResult.exceptionError,
        gasUsed: result.gasUsed.toArrayLike(Buffer),
        logs: result.execResult.logs,
        newRoot: await vm.stateManager.getStateRoot()
      };
    }
  ],
  [
    'runCall',
    async function (this: VMWorker, args: RunCallArgs): Promise<RunCallResult> {
      const common = this.getCommon(args.number);
      const opts = toRunCallOpts(args, common);
      const vm = await this.getVM(args.root, common);
      const result = await vm.runCall(opts);
      return {
        createAddress: result.createdAddress && result.createdAddress.buf,
        succeed: !result.execResult.exceptionError,
        gasUsed: result.gasUsed.toArrayLike(Buffer),
        logs: result.execResult.logs,
        returnValue: result.execResult.returnValue
      };
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
  readonly db: LevelUp;
  readonly common: Common;

  constructor(db: LevelUp, common: Common) {
    super(vmHandlers);
    this.db = db;
    this.common = common;
  }

  callLevelDB(method: string, data: any) {
    return (this.db as any)[method].apply(this.db, data);
  }

  getCommon(number: BN | Buffer) {
    const bn = number instanceof Buffer ? new BN(number) : number;
    const common = this.common.copy();
    common.setHardforkByBlockNumber(bn);
    return common;
  }

  async getStateManager(root: Buffer, number: BN | Common) {
    let common: Common;
    if (number instanceof BN) {
      common = this.common.copy();
      common.setHardforkByBlockNumber(number);
    } else {
      common = number.copy();
    }

    const stateManager = new StateManager({
      common,
      trie: new Trie(this.db)
    });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  async getVM(root: Buffer | StateManager, number: BN | Common) {
    const stateManager = root instanceof Buffer ? await this.getStateManager(root, number) : root;
    return new VM({
      listenHardforkChanged: false,
      hardforkByBlockNumber: true,
      common: stateManager._common,
      stateManager: stateManager
    });
  }
}
