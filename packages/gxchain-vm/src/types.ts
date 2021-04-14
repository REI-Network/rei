import { Address, BN } from 'ethereumjs-util';
import { InterpreterStep } from '@ethereumjs/vm/dist/evm/interpreter';

/**
 * Options for debugging.
 */
export interface DebugOpts {
  /**
   * Target transaction hash
   */
  hash?: Buffer;
  /**
   * Called when the transaction starts processing
   */
  captureStart: (from: Address, create: boolean, input: Buffer, gas: BN, value: BN, to?: Address) => void;
  /**
   * Called at every step of processing a transaction
   */
  captureState: (step: InterpreterStep) => void;
  /**
   * Called when a transaction processing error
   */
  captureFault: (step: InterpreterStep, err: any) => void;
  /**
   * Called when the transaction is processed
   */
  captureEnd: (output: Buffer, gasUsed: BN, time: number) => void;
}
