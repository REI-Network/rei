import vm from 'vm';
import bi, { BigInteger } from 'big-integer';
import { StateManager } from '@rei-network/vm/dist/state';
import { getPrecompile } from '@rei-network/vm/dist/evm/precompiles';
import {
  Address,
  BN,
  bufferToHex,
  setLengthLeft,
  generateAddress,
  generateAddress2,
  keccak256
} from 'ethereumjs-util';
import { InterpreterStep } from '@rei-network/vm/dist/evm/interpreter';
import { VmError } from '@rei-network/vm/dist/exceptions';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { calcIntrinsicGas } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { IDebugImpl, TraceConfig } from '../tracer';

/**
 * Generate and return the operation method of OP
 * @param name
 * @param code
 * @returns
 */
function makeOP(name: string, code: number) {
  return {
    isPush() {
      return name.startsWith('PUSH');
    },
    toString() {
      return name;
    },
    toNumber() {
      return code;
    }
  };
}

/**
 * Generate and return the operation method of memory
 * @param memory
 * @returns
 */
function makeMemory(memory: Buffer) {
  return {
    slice(start: number, stop: number) {
      return memory.slice(start, stop);
    },
    getUint(offset: number) {
      if (offset < 0 || offset + 32 > memory.length - 1) {
        return bi(0);
      }
      return bi(memory.slice(offset, offset + 32).readUInt32BE());
    }
  };
}

/**
 * Generate and return the operation method of contract
 * @param caller
 * @param address
 * @param value
 * @param input
 * @returns
 */
function makeContract(
  caller: Buffer,
  address: Buffer,
  value: BigInteger,
  input: Buffer
) {
  return {
    getCaller() {
      return caller;
    },
    getAddress() {
      return address;
    },
    getValue() {
      return value;
    },
    getInput() {
      return input;
    }
  };
}

/**
 * Generate and return the operation method of the database
 * @param stateManager state trie manager
 * @returns A object of functions
 */
function makeDB(stateManager: StateManager) {
  return {
    async getBalance(address: Buffer) {
      return bi(
        (await stateManager.getAccount(new Address(address))).balance.toString()
      );
    },
    async getNonce(address: Buffer) {
      return (
        await stateManager.getAccount(new Address(address))
      ).nonce.toNumber();
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
 * @param ctx
 * @param opcodes
 * @param step
 * @param error
 * @returns
 */
function makeLog(step: InterpreterStep, error?: string) {
  const stack = step.stack.map((bn) => bn.clone());
  Object.defineProperty(stack, 'peek', {
    value: (idx: number) => {
      if (idx < 0 || idx > stack.length - 1) {
        return bi(0);
      }
      return bi(stack[stack.length - idx - 1].toString());
    }
  });

  return {
    op: makeOP(step.opcode.name, step.opcode.code),
    stack,
    memory: makeMemory(step.memory),
    contract: makeContract(
      step.caller.buf,
      step.address.buf,
      bi(step.callValue.toString()),
      step.callData
    ),
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

type LogInfo = {
  log: ReturnType<typeof makeLog>;
  error: boolean;
};

function toAddress(data: Buffer | string) {
  return setLengthLeft(
    data instanceof Buffer ? data : hexStringToBuffer(data),
    20
  );
}

export class JSDebug implements IDebugImpl {
  hash?: Buffer;

  private common: Common;
  private config: TraceConfig;
  private vmContext: vm.Context;
  private reject?: (reason?: any) => void;
  private debugContext: { [key: string]: any } = {};

  private vmContextObj: {
    toHex(buf: Buffer): string;
    toWord(data: Buffer | string): Buffer;
    toAddress(data: Buffer | string): Buffer;
    toContract(data: Buffer | string, nonce: number): Buffer;
    toContract2(data: Buffer | string, salt: string, code: Buffer): Buffer;
    isPrecompiled(address: Buffer): boolean;
    slice(buf: Buffer, start: number, end: number): Buffer;
    globalLogs: LogInfo[];
    globalDB?: ReturnType<typeof makeDB>;
    globalCtx: { [key: string]: any };
    globalPromise?: Promise<any>;
    bigInt: typeof bi;
    glog(...args: any[]): void;
  } = {
    toHex(buf: Buffer) {
      return bufferToHex(buf);
    },
    toWord(data: Buffer | string) {
      return setLengthLeft(
        data instanceof Buffer ? data : hexStringToBuffer(data),
        32
      );
    },
    toAddress(data: Buffer | string) {
      return toAddress(data);
    },
    toContract(data: Buffer | string, nonce: number) {
      return generateAddress(toAddress(data), new BN(nonce).toBuffer());
    },
    toContract2(data: Buffer | string, salt: string, code: Buffer) {
      return generateAddress2(
        toAddress(data),
        hexStringToBuffer(salt),
        keccak256(code)
      );
    },
    isPrecompiled: (address: Buffer) => {
      return getPrecompile(new Address(address), this.common) !== undefined;
    },
    slice(buf: Buffer, start: number, end: number) {
      if (start < 0 || start > end || end > buf.length - 1) {
        return Buffer.alloc(0);
      }
      return buf.slice(start, end);
    },
    globalLogs: [],
    globalCtx: this.debugContext,
    bigInt: bi,
    glog(...args: any[]) {
      logger.debug('JSDebug::glog,', ...args);
    }
  };

  constructor(
    common: Common,
    config: TraceConfig,
    reject: (reason?: any) => void,
    hash?: Buffer
  ) {
    this.common = common;
    this.config = config;
    this.reject = reject;
    this.hash = hash;
    this.vmContext = vm.createContext(this.vmContextObj, {
      codeGeneration: { strings: false, wasm: false }
    });
    new vm.Script(config.tracer!).runInContext(this.vmContext);
  }

  private error(reason?: any) {
    if (this.reject) {
      this.reject(reason);
      this.reject = undefined;
    }
  }

  /**
   * CaptureStart implements the Tracer interface to initialize the tracing operation.
   * @param from
   * @param to
   * @param create
   * @param input
   * @param gas
   * @param gasPrice
   * @param value
   * @param number
   * @param stateManager
   */
  async captureStart(
    from: undefined | Buffer,
    to: undefined | Buffer,
    create: boolean,
    input: Buffer,
    gas: BN,
    gasPrice: BN,
    value: BN,
    number: BN,
    stateManager: StateManager
  ) {
    this.debugContext['type'] = create ? 'CREATE' : 'CALL';
    this.debugContext['from'] = from;
    this.debugContext['to'] = to;
    this.debugContext['input'] = input;
    this.debugContext['gas'] = bi(gas.toString());
    this.debugContext['gasPrice'] = gasPrice.toNumber();
    this.debugContext['intrinsicGas'] = calcIntrinsicGas(
      create,
      input
    ).toNumber();
    this.debugContext['value'] = bi(value.toString());
    this.debugContext['block'] = number.toNumber();
    this.vmContextObj.globalDB = makeDB(stateManager);
  }

  /**
   * Run vm scripts if cached logs reach limit or force is true
   * @param force Force run vm scripts
   */
  private async batchRunScripts(force = false) {
    if (
      (force && this.vmContextObj.globalLogs.length > 0) ||
      this.vmContextObj.globalLogs.length >
        (this.config.vmScriptsBatchSize ?? 500)
    ) {
      const script = new vm.Script(`
      globalPromise = (async () => {
        for (const { log, error } of globalLogs) {
          await (error ? obj.fault : obj.step).call(obj, log, globalDB);
        }
      })();`);
      script.runInContext(this.vmContext, {
        timeout: this.config.timeout ? Number(this.config.timeout) : undefined,
        breakOnSigint: true
      });
    }
    if (this.vmContextObj.globalPromise) {
      await this.vmContextObj.globalPromise;
      this.vmContextObj.globalPromise = undefined;
      this.vmContextObj.globalLogs = [];
    }
  }

  /**
   * CaptureLog implements the Tracer interface to trace a single step of VM execution.
   * @param step
   * @param error
   */
  private async captureLog(step: InterpreterStep, error?: string) {
    if (!this.reject) {
      return;
    }

    try {
      this.vmContextObj.globalLogs.push({
        log: makeLog(step, error),
        error: !!error
      });
      await this.batchRunScripts();
    } catch (err) {
      this.error(err);
    }
  }

  /**
   * CaptureState call the captureLog function
   * @param step
   * @param cost
   */
  async captureState(step: InterpreterStep) {
    await this.captureLog(step);
  }

  /**
   * CaptureFault implements the Tracer interface to trace an execution fault.
   * @param step
   * @param err
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
   * CaptureEnd implements the Tracer interface, called after the VM has finished executing.
   * @param output
   * @param gasUsed
   * @param time
   */
  async captureEnd(output: Buffer, gasUsed: BN, time: number) {
    this.debugContext['output'] = output;
    this.debugContext['gasUsed'] = gasUsed.toNumber();
    this.debugContext['time'] = time;
  }

  /**
   * Result calls the Javascript 'result' function and returns its value, or any accumulated error
   * @returns Debug result
   */
  async result() {
    if (!this.reject) {
      return;
    }

    try {
      await this.batchRunScripts(true);
      const script = new vm.Script(
        'globalPromise = obj.result.call(obj, globalCtx, globalDB)'
      );
      script.runInContext(this.vmContext, {
        timeout: this.config.timeout ? Number(this.config.timeout) : undefined,
        breakOnSigint: true
      });
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
