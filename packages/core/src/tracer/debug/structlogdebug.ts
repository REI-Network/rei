import { BN, setLengthLeft } from 'ethereumjs-util';
import { StateManager } from '@rei-network/vm/dist/state';
import { InterpreterStep } from '@rei-network/vm/dist/evm/interpreter';
import { VmError } from '@rei-network/vm/dist/exceptions';
import { FunctionalBufferMap } from '@rei-network/utils';
import { TraceConfig, IDebugImpl } from '../tracer';

export type StructLog = {
  depth: number;
  error?: string;
  gas: number;
  gasCost: number;
  memory: string[];
  op: string;
  pc: number;
  stack: string[];
  storage: {
    [key: string]: string;
  };
};

export class StructLogDebug implements IDebugImpl {
  hash?: Buffer;
  config: TraceConfig;
  logs: StructLog[] = [];
  output!: Buffer;
  gasUsed!: BN;
  failed: boolean = false;
  storage = new FunctionalBufferMap<{ [address: string]: string }>();

  constructor(config?: TraceConfig, hash?: Buffer) {
    this.config = config || {};
    this.hash = hash;
  }

  /**
   * captureLog logs a new structured log message and pushes it out to the environment
   * @param step Step state
   * @param error Error message
   */
  private async captureLog(step: InterpreterStep, error?: string) {
    let memory: string[] = [];
    if (!this.config.disableMemory && step.memoryWordCount.gtn(0)) {
      const memoryLength = new BN(step.memory.length).div(step.memoryWordCount).toNumber();
      memory = [];
      for (let i = 0; i < step.memoryWordCount.toNumber(); i++) {
        memory.push(step.memory.slice(i * memoryLength, (i + 1) * memoryLength).toString('hex'));
      }
    }
    let storage = this.storage.get(step.address.buf);
    if (storage === undefined) {
      storage = {};
      this.storage.set(step.address.buf, storage);
    }
    if (!this.config.disableStorage) {
      if (step.opcode.name === 'SLOAD' && step.stack.length >= 1) {
        const address = setLengthLeft(step.stack[step.stack.length - 1].toBuffer(), 32);
        const key = address.toString('hex');
        if (!(key in storage)) {
          const value = setLengthLeft(await step.stateManager.getContractStorage(step.address, address), 32);
          Object.defineProperty(storage, address.toString('hex'), {
            value: value.toString('hex'),
            enumerable: true
          });
        }
      }
      if (step.opcode.name === 'SSTORE' && step.stack.length >= 2) {
        const address = setLengthLeft(step.stack[step.stack.length - 1].toBuffer(), 32);
        const key = address.toString('hex');
        if (!(key in storage)) {
          const value = setLengthLeft(step.stack[step.stack.length - 2].toBuffer(), 32);
          Object.defineProperty(storage, address.toString('hex'), {
            value: value.toString('hex'),
            enumerable: true
          });
        }
      }
    }
    const storageObj = {};
    for (const address in storage) {
      Object.defineProperty(storageObj, address, {
        value: storage[address],
        enumerable: true
      });
    }
    // TODO: fix wrong depth.
    const log: StructLog = {
      depth: step.depth + 1,
      error,
      gas: step.gasLeft.toNumber(),
      gasCost: step.opcode.fee,
      memory,
      op: step.opcode.name,
      pc: step.pc,
      stack: !this.config.disableStack ? step.stack.map((bn) => setLengthLeft(bn.toBuffer(), 32).toString('hex')) : [],
      storage: storageObj
    };
    this.logs.push(log);
  }

  /**
   * CaptureStart implements the Tracer interface to initialize the tracing operation.
   * @param from From address
   * @param to To address
   * @param create Create or call
   * @param input Input data
   * @param gas GasLimit
   * @param gasPrice  gasPrice
   * @param value Sent to it from it's caller
   * @param number Blocknumber
   * @param stateManager state trie manager
   */
  async captureStart(from: undefined | Buffer, to: undefined | Buffer, create: boolean, input: Buffer, gas: BN, gasPrice: BN, value: BN, number: BN, stateManager: StateManager) {}

  /**
   * captureState call the captureLog function
   * @param step Step state
   */
  async captureState(step: InterpreterStep) {
    await this.captureLog(step);
  }

  /**
   * captureFault implements the Tracer interface to trace an execution fault
   * @param step Step state
   * @param err Error message
   */
  async captureFault(step: InterpreterStep, err: any) {
    let errString: string;
    if (err instanceof VmError) {
      errString = err.error;
    } else if (err instanceof Error) {
      errString = err.message;
    } else if (typeof err === 'string') {
      errString = err;
    } else {
      errString = 'unknown error';
    }
    this.failed = true;
    await this.captureLog(step, errString);
  }

  /**
   * CaptureEnd Set output value and gasused
   * @param output Output result
   * @param gasUsed Gas used
   * @param time Running time
   */
  async captureEnd(output: Buffer, gasUsed: BN, time: number) {
    this.output = output;
    this.gasUsed = gasUsed.clone();
  }

  result() {
    return {
      failed: this.failed,
      gas: this.gasUsed.toNumber(),
      returnValue: this.output.toString('hex'),
      structLogs: this.logs
    };
  }
}
