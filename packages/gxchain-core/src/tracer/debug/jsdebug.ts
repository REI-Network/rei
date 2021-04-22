import vm from 'vm';
import bi, { BigInteger } from 'big-integer';
import { StateManager } from '@ethereumjs/vm/dist/state';
import { getPrecompile } from '@ethereumjs/vm/dist/evm/precompiles';
import { Address, BN, bufferToHex, setLengthLeft, generateAddress, generateAddress2, keccak256 } from 'ethereumjs-util';
import { InterpreterStep, VmError } from '@gxchain2/vm';
import { hexStringToBuffer, logger } from '@gxchain2/utils';
import { IDebugImpl, TraceConfig } from '../tracer';
import { Node } from '../../node';

class Op {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  isPush() {
    return this.name === 'PUSH';
  }
  toString() {
    return this.name;
  }
  toNumber() {
    logger.warn('JSDebug_Op::toNumber, unsupported api');
    return 0;
  }
}

class Memory {
  memory: Buffer;
  constructor(memory: Buffer) {
    this.memory = memory;
  }
  slice(start: number, stop: number) {
    return this.memory.slice(start, stop);
  }
  getUint(offset: number) {
    if (offset < 0 || offset + 32 > this.memory.length - 1) {
      return bi(0);
    }
    return this.memory.slice(offset, offset + 32).readUInt32BE();
  }
}

class Contract {
  caller: Buffer;
  address: Buffer;
  value: BigInteger;
  input: Buffer;
  constructor(caller: Buffer, address: Buffer, value: BigInteger, input: Buffer) {
    this.caller = caller;
    this.address = address;
    this.value = value;
    this.input = input;
  }
  getCaller() {
    return this.caller;
  }
  getAddress() {
    return this.address;
  }
  getValue() {
    return this.value;
  }
  getInput() {
    return this.input;
  }
}

function makeDB(stateManager: StateManager) {
  return {
    async getBalance(address: Buffer) {
      try {
        return bi((await stateManager.getAccount(new Address(address))).balance.toString());
      } catch (err) {
        logger.warn('JSDebug_DB::getBalance, catch error:', err);
        return bi(0);
      }
    },
    async getNonce(address: Buffer) {
      try {
        return (await stateManager.getAccount(new Address(address))).nonce.toNumber();
      } catch (err) {
        logger.warn('JSDebug_DB::getNonce, catch error:', err);
        return 0;
      }
    },
    async getCode(address: Buffer) {
      try {
        return await stateManager.getContractCode(new Address(address));
      } catch (err) {
        logger.warn('JSDebug_DB::getCode, catch error:', err);
        return Buffer.alloc(0);
      }
    },
    async getState(address: Buffer, hash: Buffer) {
      try {
        return await stateManager.getContractStorage(new Address(address), hash);
      } catch (err) {
        logger.warn('JSDebug_DB::getState, catch error:', err);
        return Buffer.alloc(0);
      }
    },
    async exists(address: Buffer) {
      try {
        return await stateManager.accountExists(new Address(address));
      } catch (err) {
        logger.warn('JSDebug_DB::exists, catch error:', err);
        return false;
      }
    }
  };
}

function makeLog(ctx: { [key: string]: any }, step: InterpreterStep, cost: BN, error?: string) {
  const stack = step.stack.map((bn) => bi(bn.toString()));
  Object.defineProperty(stack, 'peek', {
    value: (idx: number) => {
      if (idx < 0 || idx > stack.length - 1) {
        return bi(0);
      }
      return stack[idx];
    }
  });
  return {
    op: new Op(step.opcode.name),
    stack,
    memory: new Memory(step.memory),
    contract: new Contract(ctx['from'], ctx['to'], ctx['value'], ctx['input']),
    getPC() {
      return step.pc;
    },
    getGas() {
      return step.gasLeft.toNumber();
    },
    getCost() {
      return cost.toNumber();
    },
    getDepth() {
      return step.depth + 1;
    },
    getRefund() {
      logger.warn('JSDebug_Log::getRefund, unsupported api');
      return 0;
    },
    getError() {
      return error;
    }
  };
}

export class JSDebug implements IDebugImpl {
  hash: Buffer | undefined;
  private node: Node;
  private config: TraceConfig;
  private debugContext: {
    [key: string]: any;
  } = {};
  private vmContextObj: {
    toHex(buf: Buffer): string;
    toWord(data: Buffer | string): Buffer;
    toAddress(data: Buffer | string): Buffer;
    toContract(data: Buffer | string, nonce: number): Buffer;
    toContract2(data: Buffer | string, salt: string, code: Buffer): Buffer;
    isPrecompiled(address: Buffer): boolean;
    slice(buf: Buffer, start: number, end: number): Buffer;
    globalLog?: ReturnType<typeof makeLog>;
    globalDB?: ReturnType<typeof makeDB>;
    globalCtx: { [key: string]: any };
    globalPromise?: Promise<any>;
    glog(...args: any[]): void;
    bigInt: typeof bi;
  } = {
    toHex(buf: Buffer) {
      return bufferToHex(buf);
    },
    toWord(data: Buffer | string) {
      return setLengthLeft(data instanceof Buffer ? data : hexStringToBuffer(data), 32);
    },
    toAddress(data: Buffer | string) {
      return setLengthLeft(data instanceof Buffer ? data : hexStringToBuffer(data), 20);
    },
    toContract(data: Buffer | string, nonce: number) {
      return generateAddress(data instanceof Buffer ? data : hexStringToBuffer(data), new BN(nonce).toBuffer());
    },
    toContract2(data: Buffer | string, salt: string, code: Buffer) {
      return generateAddress2(data instanceof Buffer ? data : hexStringToBuffer(data), hexStringToBuffer(salt), keccak256(code));
    },
    isPrecompiled: (address: Buffer) => {
      return getPrecompile(new Address(address), this.node.common) !== undefined;
    },
    slice(buf: Buffer, start: number, end: number) {
      if (start < 0 || start > end || end > buf.length - 1) {
        logger.warn('JSDebug::slice, tracer accessed out of bound memory, available', buf.length - 1, 'start:', start, 'end:', end);
        return Buffer.alloc(0);
      }
      return buf.slice(start, end);
    },
    globalCtx: this.debugContext,
    glog(...args: any[]) {
      logger.detail('JSDebug::glog,', ...args);
    },
    bigInt: bi
  };
  private vmContext: vm.Context;

  constructor(node: Node, config: TraceConfig) {
    this.node = node;
    this.config = config;
    this.vmContext = vm.createContext(this.vmContextObj, { codeGeneration: { strings: false, wasm: false } });
    try {
      new vm.Script(config.tracer!).runInContext(this.vmContext);
    } catch (err) {
      logger.warn('JSDebug::constructor, catch error:', err);
    }
  }

  async captureStart(from: undefined | Buffer, to: undefined | Buffer, create: boolean, input: Buffer, gas: BN, value: BN, number: BN, stateManager: StateManager) {
    this.debugContext['type'] = create ? 'CREATE' : 'CALL';
    this.debugContext['from'] = from;
    this.debugContext['to'] = to;
    this.debugContext['input'] = input;
    this.debugContext['gas'] = gas.toNumber();
    this.debugContext['value'] = bi(value.toString());
    this.debugContext['block'] = number.toNumber();
    this.vmContextObj.globalDB = makeDB(stateManager);
  }

  private async captureLog(step: InterpreterStep, cost: BN, error?: string) {
    try {
      this.vmContextObj.globalLog = makeLog(this.debugContext, step, cost, error);
      const script = error ? new vm.Script('globalPromise = obj.fault.call(obj, globalLog, globalDB)') : new vm.Script('globalPromise = obj.step.call(obj, globalLog, globalDB)');
      script.runInContext(this.vmContext, { timeout: this.config.timeout ? Number(this.config.timeout) : undefined, breakOnSigint: true });
      if (this.vmContextObj.globalPromise) {
        await this.vmContextObj.globalPromise;
        this.vmContextObj.globalPromise = undefined;
      }
    } catch (err) {
      logger.warn('JSDebug::captureLog, catch error:', err);
    }
  }

  async captureState(step: InterpreterStep, cost: BN) {
    await this.captureLog(step, cost);
  }

  async captureFault(step: InterpreterStep, cost: BN, err: any) {
    let errString: string;
    if (err instanceof VmError) {
      errString = err.error;
    } else if (err instanceof Error) {
      errString = err.message;
    } else if (typeof err === 'string') {
      errString = err;
    } else {
      errString = 'unkonw error';
    }
    await this.captureLog(step, cost, errString);
  }

  async captureEnd(output: Buffer, gasUsed: BN, time: number) {
    this.debugContext['output'] = output;
    this.debugContext['gasUsed'] = gasUsed.toNumber();
    this.debugContext['time'] = time;
  }

  async result() {
    try {
      new vm.Script('globalPromise = obj.result.call(obj, globalCtx, globalDB)').runInContext(this.vmContext, { timeout: this.config.timeout ? Number(this.config.timeout) : undefined, breakOnSigint: true });
      if (this.vmContextObj.globalPromise) {
        const result = await this.vmContextObj.globalPromise;
        this.vmContextObj.globalPromise = undefined;
        return result;
      }
    } catch (err) {
      logger.warn('JSDebug::result, catch error:', err);
    }
  }
}
