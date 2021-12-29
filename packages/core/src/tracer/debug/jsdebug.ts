import vm from 'vm';
import bi, { BigInteger } from 'big-integer';
import { StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { getPrecompile } from '@gxchain2-ethereumjs/vm/dist/evm/precompiles';
import { OpcodeList } from '@gxchain2-ethereumjs/vm/dist/evm/opcodes';
import { Address, BN, bufferToHex, setLengthLeft, generateAddress, generateAddress2, keccak256 } from 'ethereumjs-util';
import { InterpreterStep } from '@gxchain2-ethereumjs/vm/dist/evm/interpreter';
import { VmError } from '@gxchain2-ethereumjs/vm/dist/exceptions';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { calcIntrinsicGas } from '@rei-network/structure';
import { IDebugImpl, TraceConfig } from '../tracer';
import { Node } from '../../node';

/**
 * Convert operation name to number
 * @param opcodes Opcodes collection
 * @param name Opcode name
 * @returns Opcode number
 */
function opNameToNumber(opcodes: OpcodeList, name: string) {
  if (name.indexOf('LOG') === 0) {
    return Number(name.substr(3)) + 0xa0;
  } else if (name.indexOf('PUSH') === 0) {
    return Number(name.substr(4)) + 0x5f;
  } else if (name.indexOf('DUP') === 0) {
    return Number(name.substr(3)) + 0x7f;
  } else if (name.indexOf('SWAP') === 0) {
    return Number(name.substr(4)) + 0x8f;
  }
  for (const [code, opcode] of opcodes) {
    if (code >= 0x60 && code <= 0xa4) {
      continue;
    }
    if (opcode.name === name) {
      return code;
    }
  }
  throw new Error(`unknown opcode: ${name}`);
}

/**
 * Used to manage an operation object
 */
class Op {
  name: string;
  constructor(opcodes: OpcodeList, name: string) {
    this.name = name;
    this.toNumber = () => {
      const res = opNameToNumber(opcodes, this.name);
      return res;
    };
  }
  isPush() {
    return this.name.indexOf('PUSH') === 0;
  }
  toString() {
    return this.name;
  }
  toNumber: () => number;
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
    return bi(this.memory.slice(offset, offset + 32).readUInt32BE());
  }
}

/**
 * Contract represents an ethereum contract in the state database. It contains
 * the contract code, calling arguments.
 */
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
  /**
   * getCaller returns the caller of the contract.
   * @returns Contract caller
   */
  getCaller() {
    return this.caller;
  }

  /**
   * getAddress returns the contracts address
   * @returns contracts address
   */
  getAddress() {
    return this.address;
  }

  /**
   * getValue returns the contract's value (sent to it from it's caller)
   * @returns contract's value
   */
  getValue() {
    return this.value;
  }
  /**
   * getInput return the input data
   * @returns Input data
   */
  getInput() {
    return this.input;
  }
}

/**
 * Generate and return the operation method of the database
 * @param stateManager state trie manager
 * @returns A object of functions
 */
function makeDB(stateManager: StateManager) {
  return {
    async getBalance(address: Buffer) {
      return bi((await stateManager.getAccount(new Address(address))).balance.toString());
    },
    async getNonce(address: Buffer) {
      return (await stateManager.getAccount(new Address(address))).nonce.toNumber();
    },
    getCode(address: Buffer) {
      return stateManager.getContractCode(new Address(address));
    },
    getState(address: Buffer, hash: Buffer) {
      return stateManager.getContractStorage(new Address(address), hash);
    },
    exists(address: Buffer) {
      return stateManager.accountExists(new Address(address));
    }
  };
}

/**
 * Generate and return the operation method of the log
 * @param ctx Contract transaction information
 * @param opcodes Opcodes collection
 * @param step Step state
 * @param error Error message
 * @returns A object for get contract parameter
 */
function makeLog(ctx: { [key: string]: any }, opcodes: OpcodeList, step: InterpreterStep, error?: string) {
  const stack = step.stack.map((bn) => bi(bn.toString())).reverse();
  Object.defineProperty(stack, 'peek', {
    value: (idx: number) => {
      if (idx < 0 || idx > stack.length - 1) {
        return bi(0);
      }
      return stack[idx];
    }
  });
  return {
    op: new Op(opcodes, step.opcode.name),
    stack,
    memory: new Memory(step.memory),
    contract: new Contract(ctx['from'], ctx['to'], ctx['value'], ctx['input']),
    getPC() {
      return step.pc;
    },
    getGas() {
      return bi(step.gasLeft.toString());
    },
    getCost() {
      return bi(step.opcode.fee);
    },
    getDepth() {
      return step.depth + 1;
    },
    getRefund() {
      throw new Error('unsupported api getRefund');
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
      return getPrecompile(new Address(address), this.node.getCommon(this.debugContext['block'])) !== undefined;
    },
    slice(buf: Buffer, start: number, end: number) {
      if (start < 0 || start > end || end > buf.length - 1) {
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
  private opcodes: OpcodeList;
  private rejected: boolean = false;
  private reject: (reason?: any) => void;

  constructor(node: Node, opcodes: OpcodeList, reject: (reason?: any) => void, config: TraceConfig) {
    this.node = node;
    this.config = config;
    this.opcodes = opcodes;
    this.vmContext = vm.createContext(this.vmContextObj, { codeGeneration: { strings: false, wasm: false } });
    this.reject = reject;
    new vm.Script(config.tracer!).runInContext(this.vmContext);
  }

  private error(reason?: any) {
    if (!this.rejected) {
      this.rejected = true;
      this.reject(reason);
    }
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
  async captureStart(from: undefined | Buffer, to: undefined | Buffer, create: boolean, input: Buffer, gas: BN, gasPrice: BN, value: BN, number: BN, stateManager: StateManager) {
    this.debugContext['type'] = create ? 'CREATE' : 'CALL';
    this.debugContext['from'] = from;
    this.debugContext['to'] = to;
    this.debugContext['input'] = input;
    this.debugContext['gas'] = bi(gas.toString());
    this.debugContext['gasPrice'] = gasPrice.toNumber();
    this.debugContext['intrinsicGas'] = calcIntrinsicGas(create, input).toNumber();
    this.debugContext['value'] = bi(value.toString());
    this.debugContext['block'] = number.toNumber();
    this.vmContextObj.globalDB = makeDB(stateManager);
  }

  /**
   * captureLog implements the Tracer interface to trace a single step of VM execution.
   * @param step Step state
   * @param error Error message
   * @returns
   */
  private async captureLog(step: InterpreterStep, error?: string) {
    if (this.rejected) {
      return;
    }
    try {
      this.vmContextObj.globalLog = makeLog(this.debugContext, this.opcodes, step, error);
      const script = error ? new vm.Script('globalPromise = obj.fault.call(obj, globalLog, globalDB)') : new vm.Script('globalPromise = obj.step.call(obj, globalLog, globalDB)');
      script.runInContext(this.vmContext, { timeout: this.config.timeout ? Number(this.config.timeout) : undefined, breakOnSigint: true });
      if (this.vmContextObj.globalPromise) {
        await this.vmContextObj.globalPromise;
        this.vmContextObj.globalPromise = undefined;
      }
    } catch (err) {
      this.error(err);
    }
  }

  /**
   * captureState call the captureLog function
   * @param step Step state
   * @param cost Cost value
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
    await this.captureLog(step, errString);
  }

  /**
   * CaptureEnd is called after the call finishes to finalize the tracing.
   * @param output Output result
   * @param gasUsed Gas used
   * @param time Running time
   */
  async captureEnd(output: Buffer, gasUsed: BN, time: number) {
    this.debugContext['output'] = output;
    this.debugContext['gasUsed'] = gasUsed.toNumber();
    this.debugContext['time'] = time;
  }

  /**
   * GetResult calls the Javascript 'result' function and returns its value, or any accumulated error
   * @returns
   */
  async result() {
    if (this.rejected) {
      return;
    }
    try {
      new vm.Script('globalPromise = obj.result.call(obj, globalCtx, globalDB)').runInContext(this.vmContext, { timeout: this.config.timeout ? Number(this.config.timeout) : undefined, breakOnSigint: true });
      if (this.vmContextObj.globalPromise) {
        const result = await this.vmContextObj.globalPromise;
        this.vmContextObj.globalPromise = undefined;
        return result;
      }
    } catch (err) {
      this.error(err);
    }
  }
}
