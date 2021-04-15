import { DebugOpts, InterpreterStep, VmError } from '@gxchain2/vm';
import { Address, BN, setLengthLeft } from 'ethereumjs-util';
import { TraceConfig } from '../tracer';

export type StructLog = {
  depth: number;
  error?: string;
  gas: number;
  gasCost: number;
  memory: null | string[];
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

  constructor(config: TraceConfig, hash?: Buffer) {
    this.config = config;
    this.hash = hash;
  }

  private captureLog(step: InterpreterStep, error?: string) {
    let memory: null | string[] = null;
    if (!this.config.disableMemory && step.memoryWordCount.gtn(0)) {
      const memoryLength = new BN(step.memory.length).div(step.memoryWordCount).toNumber();
      memory = [];
      for (let i = 0; i < step.memoryWordCount.toNumber(); i++) {
        memory.push(step.memory.slice(i * memoryLength, (i + 1) * memoryLength).toString('hex'));
      }
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
      storage: !this.config.disableStorage ? {} : {}
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
