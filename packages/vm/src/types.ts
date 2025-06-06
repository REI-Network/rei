import { BN } from 'ethereumjs-util';
import { Log } from './evm/types';
import { InterpreterStep } from './evm/interpreter';
import { StateManager } from './state';

export type TxReceipt =
  | PreByzantiumTxReceipt
  | PostByzantiumTxReceipt
  | EIP2930Receipt;

/**
 * Abstract interface with common transaction receipt fields
 */
export interface BaseTxReceipt {
  /**
   * Cumulative gas used in the block including this tx
   */
  gasUsed: Buffer;
  /**
   * Bloom bitvector
   */
  bitvector: Buffer;
  /**
   * Logs emitted
   */
  logs: Log[];
}

/**
 * Pre-Byzantium receipt type with a field
 * for the intermediary state root
 */
export interface PreByzantiumTxReceipt extends BaseTxReceipt {
  /**
   * Intermediary state root
   */
  stateRoot: Buffer;
}

/**
 * Receipt type for Byzantium and beyond replacing the intermediary
 * state root field with a status code field (EIP-658)
 */
export interface PostByzantiumTxReceipt extends BaseTxReceipt {
  /**
   * Status of transaction, `1` if successful, `0` if an exception occured
   */
  status: 0 | 1;
}

/**
 * EIP2930Receipt, which has the same fields as PostByzantiumTxReceipt
 *
 * @deprecated Please use PostByzantiumTxReceipt instead
 */
export type EIP2930Receipt = PostByzantiumTxReceipt;

/**
 * EIP1559Receipt, which has the same fields as PostByzantiumTxReceipt
 *
 * @deprecated Please use PostByzantiumTxReceipt instead
 */
export type EIP1559Receipt = PostByzantiumTxReceipt;

/**
 * Options for debugging.
 */
// eslint-disable-next-line
export interface IDebug {
  /**
   * Target transaction hash
   */
  hash?: Buffer;
  /**
   * Called when the transaction starts processing
   */
  captureStart(
    from: undefined | Buffer,
    to: undefined | Buffer,
    create: boolean,
    input: Buffer,
    gas: BN,
    gasPrice: BN,
    value: BN,
    number: BN,
    stateManager: StateManager
  ): Promise<void>;
  /**
   * Called at every step of processing a transaction
   */
  captureState(step: InterpreterStep): Promise<void>;
  /**
   * Called when a transaction error occurs
   */
  captureFault(step: InterpreterStep, err: any): Promise<void>;
  /**
   * Called when processing a transaction
   */
  captureEnd(output: Buffer, gasUsed: BN, time: number): Promise<void>;
}
