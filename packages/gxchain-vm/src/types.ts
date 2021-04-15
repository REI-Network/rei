import { Address, BN } from 'ethereumjs-util';
import { InterpreterStep } from '@ethereumjs/vm/dist/evm/interpreter';

/**
 * Options for debugging.
 */
export interface IDebug {
  /**
   * Target transaction hash
   */
  hash?: Buffer;
  /**
   * Called when the transaction starts processing
   */
  captureStart(from: Address, create: boolean, input: Buffer, gas: BN, value: BN, to?: Address): Promise<void>;
  /**
   * Called at every step of processing a transaction
   */
  captureState(step: InterpreterStep, cost: BN): Promise<void>;
  /**
   * Called when a transaction processing error
   */
  captureFault(step: InterpreterStep, cost: BN, err: any): Promise<void>;
  /**
   * Called when the transaction is processed
   */
  captureEnd(output: Buffer, gasUsed: BN, time: number): Promise<void>;
}
