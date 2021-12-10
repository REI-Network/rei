import { BNLike } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { Common } from '@rei-network/common';
import { Blockchain } from '@rei-network/blockchain';
import { Database } from '@rei-network/database';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { RunBlockOpts, RunBlockResult } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { RunTxOpts, RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { Block, TypedTransaction, Receipt } from '@rei-network/structure';
import { ValidatorSet } from '../staking';
import { StakeManager, Router } from '../contracts';
import { Evidence, ExtraData } from '../consensus/reimint/types';
import { CommitBlockOptions } from '../types';
import { ValidatorSets } from '../staking';

export interface FinalizeOpts {
  block: Block;
  stateRoot: Buffer;
  transactions: TypedTransaction[];
  receipts: TxReceipt[];

  round?: number;
  evidence?: Evidence[];
  parentStateRoot?: Buffer;
}

export interface FinalizeResult {
  finalizedStateRoot: Buffer;
  receiptTrie: Buffer;
}

export interface ProcessBlockOpts extends Pick<RunBlockOpts, 'block' | 'runTxOpts' | 'debug'> {
  skipConsensusValidation?: boolean;
  skipConsensusVerify?: boolean;
}

export interface ProcessBlockResult extends Omit<RunBlockResult, 'receipts'> {
  receipts: Receipt[];
  validatorSet?: ValidatorSet;
  extraData?: ExtraData;
}

export interface ProcessTxOptions extends Omit<RunTxOpts, 'block' | 'beforeTx' | 'afterTx' | 'assignTxReward' | 'generateTxReceipt' | 'skipBalance'> {
  block: Block;
  vm: VM;
}

export interface ExecutorBackend {
  readonly db: Database;
  readonly blockchain: Blockchain;
  readonly validatorSets: ValidatorSets;
  getCommon(num: BNLike): Common;
  getStateManager(root: Buffer, num: BNLike | Common): Promise<StateManager>;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
  getStakeManager(vm: VM, block: Block, common?: Common): StakeManager;
  getRouter(vm: VM, block: Block, common?: Common): Router;
  commitBlock(options: CommitBlockOptions): Promise<boolean>;
}

export interface Executor {
  /**
   * Finalize a pending block,
   * assign block reward to miner and
   * do other things(afterApply) and
   * calculate finalized state root and
   * receipt trie
   * @param options - Finalize options
   * @return FinalizedStateRoot and receiptTrie
   */
  finalize(options: FinalizeOpts): Promise<FinalizeResult>;

  /**
   * Process a block
   * @param options - Process block options
   * @returns ProcessBlockResult
   */
  processBlock(options: ProcessBlockOpts): Promise<ProcessBlockResult>;

  /**
   * Process transaction
   * @param options - Process transaction options
   * @returns RunTxResult
   */
  processTx(options: ProcessTxOptions): Promise<RunTxResult>;
}
