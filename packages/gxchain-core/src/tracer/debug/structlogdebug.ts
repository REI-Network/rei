import { Address, BN, setLengthLeft } from 'ethereumjs-util';
import { DebugOpts, InterpreterStep, VmError } from '@gxchain2/vm';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { TraceConfig } from '../tracer';

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

export class StructLogDebug implements DebugOpts {
  hash?: Buffer;
  config: TraceConfig;
  logs: StructLog[] = [];
  output!: Buffer;
  gasUsed!: BN;
  failed: boolean = false;
  storage = createBufferFunctionalMap<{ [address: string]: string }>();

  constructor(config: TraceConfig, hash?: Buffer) {
    this.config = config;
    this.hash = hash;
  }

  private captureLog(step: InterpreterStep, error?: string) {
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
        // TODO: async
        const value = step.stateManager.getContractStorage(step.address, address);
        Object.defineProperty(storage, address.toString('hex'), {
          value: (value as any).toString('hex'),
          enumerable: true
        });
      }
      if (step.opcode.name === 'SSTORE' && step.stack.length >= 2) {
        const address = setLengthLeft(step.stack[step.stack.length - 1].toBuffer(), 32);
        const value = setLengthLeft(step.stack[step.stack.length - 2].toBuffer(), 32);
        Object.defineProperty(storage, address.toString('hex'), {
          value: value.toString('hex'),
          enumerable: true
        });
      }
    }
    const storageObj = {};
    for (const address in storage) {
      Object.defineProperty(storageObj, address, {
        value: storage[address],
        enumerable: true
      });
    }
    const log: StructLog = {
      depth: step.depth,
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

  captureStart(from: Address, create: boolean, input: Buffer, gas: BN, value: BN, to?: Address) {}

  captureState(step: InterpreterStep) {
    this.captureLog(step);
  }

  captureFault(step: InterpreterStep, err: any) {
    let errString: string;
    if (err instanceof VmError) {
      errString = err.errorType;
    } else if (err instanceof Error) {
      errString = err.message;
    } else if (typeof err === 'string') {
      errString = err;
    } else {
      errString = 'unkonw error';
    }
    this.failed = true;
    this.captureLog(step, errString);
  }

  captureEnd(output: Buffer, gasUsed: BN, time: number) {
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
