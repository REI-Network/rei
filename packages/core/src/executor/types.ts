import { BNLike, BN } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { Common } from '@rei-network/common';
import { Blockchain } from '@rei-network/blockchain';
import { Database } from '@rei-network/database';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
import { Block, TypedTransaction, Receipt } from '@rei-network/structure';
import { StakeManager, Router } from '../contracts';
import { Evidence } from '../consensus/reimint/types';
import { ValidatorSets, ValidatorSet } from '../staking';

export interface FinalizeOpts {
  block: Block;
  stateRoot: Buffer;
  receipts: Receipt[];

  round?: number;
  evidence?: Evidence[];
  parentStateRoot?: Buffer;
}

export interface FinalizeResult {
  finalizedStateRoot: Buffer;
  validatorSet?: ValidatorSet;
}

export interface ProcessBlockOpts {
  block: Block;
  skipConsensusValidation?: boolean;
  skipConsensusVerify?: boolean;
}

export interface ProcessBlockResult {
  receipts: Receipt[];
  validatorSet?: ValidatorSet;
}

export interface ProcessTxOpts {
  block: Block;
  root: Buffer;
  tx: TypedTransaction;
  blockGasUsed?: BN;
}

export interface ProcessTxResult {
  receipt: Receipt;
  gasUsed: BN;
  bloom: Bloom;
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

  checkEvidence(evidence: Evidence[]): Promise<void>;
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
  processTx(options: ProcessTxOpts): Promise<ProcessTxResult>;
}
