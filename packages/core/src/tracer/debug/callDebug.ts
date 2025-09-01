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

export class CallDebug implements IDebugImpl {
  hash?: Buffer;

  private common: Common;
  private config: TraceConfig;
  private reject?: (reason?: any) => void;
  private trancer: CallDebugTracer;

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
    this.trancer = new CallDebugTracer(common);
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
    this.trancer.globalCtx['type'] = create ? 'CREATE' : 'CALL';
    this.trancer.globalCtx['from'] = from;
    this.trancer.globalCtx['to'] = to;
    this.trancer.globalCtx['input'] = input;
    this.trancer.globalCtx['gas'] = bi(gas.toString());
    this.trancer.globalCtx['gasPrice'] = gasPrice.toNumber();
    this.trancer.globalCtx['intrinsicGas'] = calcIntrinsicGas(
      create,
      input
    ).toNumber();
    this.trancer.globalCtx['value'] = bi(value.toString());
    this.trancer.globalCtx['block'] = number.toNumber();
    this.trancer.globalCtx['globalDB'] = makeDB(stateManager);
  }

  /**
   * Run vm scripts if cached logs reach limit or force is true
   * @param force Force run vm scripts
   */
  private async batchRunScripts(force = false) {
    if (
      (force && this.trancer.globalLogs.length > 0) ||
      this.trancer.globalLogs.length > (this.config.vmScriptsBatchSize ?? 500)
    ) {
      this.trancer.globalPromise = (async () => {
        for (const { log, error } of this.trancer.globalLogs) {
          await (error ? this.trancer.fault : this.trancer.step).call(
            this.trancer,
            log,
            this.trancer.globalCtx['globalDB']
          );
        }
      })();
      await this.trancer.globalPromise;
    }
    if (this.trancer.globalPromise) {
      await this.trancer.globalPromise;
      this.trancer.globalPromise = undefined;
      this.trancer.globalLogs = [];
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
      this.trancer.globalLogs.push({
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
    this.trancer.globalCtx['output'] = output;
    this.trancer.globalCtx['gasUsed'] = gasUsed.toNumber();
    this.trancer.globalCtx['time'] = time;
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
      return await this.trancer.result.call(
        this.trancer,
        this.trancer.globalCtx,
        this.trancer.globalCtx['globalDB']
      );
    } catch (err) {
      this.error(err);
    }
  }
}

class CallDebugTracer {
  common: Common;
  globalCtx: { [key: string]: any } = {};
  globalLogs: LogInfo[] = [];
  globalPromise?: Promise<any>;
  private bigInt: typeof bi = bi;
  private callstack: any = [{}];
  private descended = false;

  constructor(common: Common) {
    this.common = common;
  }

  private toHex(buf: Buffer) {
    return bufferToHex(buf);
  }

  private toWord(data: Buffer | string) {
    return setLengthLeft(
      data instanceof Buffer ? data : hexStringToBuffer(data),
      32
    );
  }

  private toAddress(data: Buffer | string) {
    return toAddress(data);
  }

  private toContract(data: Buffer | string, nonce: number) {
    return generateAddress(toAddress(data), new BN(nonce).toBuffer());
  }

  private toContract2(data: Buffer | string, salt: string, code: Buffer) {
    return generateAddress2(
      toAddress(data),
      hexStringToBuffer(salt),
      keccak256(code)
    );
  }

  private isPrecompiled(address: Buffer) {
    return getPrecompile(new Address(address), this.common) !== undefined;
  }

  private slice(buf: Buffer, start: number, end: number) {
    if (start < 0 || start > end || end > buf.length - 1) {
      return Buffer.alloc(0);
    }
    return buf.slice(start, end);
  }

  private glog(...args: any[]) {
    logger.debug('callDebug::glog,', ...args);
  }

  step(log, db) {
    // Capture any errors immediately
    let error = log.getError();
    if (error !== undefined) {
      this.fault(log, db);
      return;
    }
    // We only care about system opcodes, faster if we pre-check once
    let op;
    const syscall = (log.op.toNumber() & 0xf0) == 0xf0;
    if (syscall) {
      op = log.op.toString();
    }
    // If a new contract is being created, add to the call stack
    if (syscall && (op == 'CREATE' || op == 'CREATE2')) {
      const inOff = log.stack.peek(1).valueOf();
      const inEnd = inOff + log.stack.peek(2).valueOf();

      // Assemble the internal call report and store for completion
      const call = {
        type: op,
        from: this.toHex(log.contract.getAddress()),
        input: this.toHex(log.memory.slice(inOff, inEnd)),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        value: '0x' + log.stack.peek(0).toString(16)
      };
      this.callstack.push(call);
      this.descended = true;
      return;
    }
    // If a contract is being self destructed, gather that as a subcall too
    if (syscall && op == 'SELFDESTRUCT') {
      const left = this.callstack.length;
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push({
        type: op,
        from: this.toHex(log.contract.getAddress()),
        to: this.toHex(toAddress(log.stack.peek(0).toString(16))),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        value: '0x' + db.getBalance(log.contract.getAddress()).toString(16)
      });
      return;
    }
    // If a new method invocation is being done, add to the call stack
    if (
      syscall &&
      (op == 'CALL' ||
        op == 'CALLCODE' ||
        op == 'DELEGATECALL' ||
        op == 'STATICCALL')
    ) {
      // Skip any pre-compile invocations, those are just fancy opcodes
      const to = toAddress(log.stack.peek(1).toString(16));
      if (this.isPrecompiled(to)) {
        return;
      }
      const off = op == 'DELEGATECALL' || op == 'STATICCALL' ? 0 : 1;

      const inOff = log.stack.peek(2 + off).valueOf();
      const inEnd = inOff + log.stack.peek(3 + off).valueOf();

      // Assemble the internal call report and store for completion
      const call = {
        type: op,
        from: this.toHex(log.contract.getAddress()),
        to: this.toHex(to),
        input: this.toHex(log.memory.slice(inOff, inEnd)),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        outOff: log.stack.peek(4 + off).valueOf(),
        outLen: log.stack.peek(5 + off).valueOf()
      };
      if (op != 'DELEGATECALL' && op != 'STATICCALL') {
        call['value'] = '0x' + log.stack.peek(2).toString(16);
      }
      this.callstack.push(call);
      this.descended = true;
      return;
    }
    // If we've just descended into an inner call, retrieve it's true allowance. We
    // need to extract if from within the call as there may be funky gas dynamics
    // with regard to requested and actually given gas (2300 stipend, 63/64 rule).
    if (this.descended) {
      if (log.getDepth() >= this.callstack.length) {
        this.callstack[this.callstack.length - 1].gas = log.getGas();
      } else {
        // TODO(karalabe): The call was made to a plain account. We currently don't
        // have access to the true gas amount inside the call and so any amount will
        // mostly be wrong since it depends on a lot of input args. Skip gas for now.
      }
      this.descended = false;
    }
    // If an existing call is returning, pop off the call stack
    if (syscall && op == 'REVERT') {
      this.callstack[this.callstack.length - 1].error = 'execution reverted';
      return;
    }
    if (log.getDepth() == this.callstack.length - 1) {
      // Pop off the last call and get the execution results
      const call = this.callstack.pop();

      if (call.type == 'CREATE' || call.type == 'CREATE2') {
        // If the call was a CREATE, retrieve the contract address and output code
        call.gasUsed =
          '0x' +
          this.bigInt(call.gasIn - call.gasCost - log.getGas()).toString(16);
        delete call.gasIn;
        delete call.gasCost;

        const ret = log.stack.peek(0);
        if (!ret.equals(0)) {
          call.to = this.toHex(toAddress(ret.toString(16)));
          call.output = this.toHex(db.getCode(toAddress(ret.toString(16))));
        } else if (call.error === undefined) {
          call.error = 'internal failure'; // TODO(karalabe): surface these faults somehow
        }
      } else {
        // If the call was a contract call, retrieve the gas usage and output
        if (call.gas !== undefined) {
          call.gasUsed =
            '0x' +
            this.bigInt(
              call.gasIn - call.gasCost + call.gas - log.getGas()
            ).toString(16);
        }
        const ret = log.stack.peek(0);
        if (!ret.equals(0)) {
          call.output = this.toHex(
            log.memory.slice(call.outOff, call.outOff + call.outLen)
          );
        } else if (call.error === undefined) {
          call.error = 'internal failure'; // TODO(karalabe): surface these faults somehow
        }
        delete call.gasIn;
        delete call.gasCost;
        delete call.outOff;
        delete call.outLen;
      }
      if (call.gas !== undefined) {
        call.gas = '0x' + this.bigInt(call.gas).toString(16);
      }
      // Inject the call into the previous one
      const left = this.callstack.length;
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push(call);
    }
  }

  fault(log: ReturnType<typeof makeLog>, db: ReturnType<typeof makeDB>) {
    // If the topmost call already reverted, don't handle the additional fault again
    if (this.callstack[this.callstack.length - 1].error !== undefined) {
      return;
    }
    // Pop off the just failed call
    const call = this.callstack.pop();
    call.error = log.getError();

    // Consume all available gas and clean any leftovers
    if (call.gas !== undefined) {
      call.gas = '0x' + this.bigInt(call.gas).toString(16);
      call.gasUsed = call.gas;
    }
    delete call.gasIn;
    delete call.gasCost;
    delete call.outOff;
    delete call.outLen;

    // Flatten the failed call into its parent
    const left = this.callstack.length;
    if (left > 0) {
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push(call);
      return;
    }
    // Last call failed too, leave it in the stack
    this.callstack.push(call);
  }

  result(ctx, db) {
    let result: any = {
      type: ctx.type,
      from: this.toHex(ctx.from),
      to: this.toHex(ctx.to),
      value: '0x' + ctx.value.toString(16),
      gas: '0x' + this.bigInt(ctx.gas).toString(16),
      gasUsed: '0x' + this.bigInt(ctx.gasUsed).toString(16),
      input: this.toHex(ctx.input),
      output: this.toHex(ctx.output),
      time: ctx.time
    };
    if (this.callstack[0].calls !== undefined) {
      result.calls = this.callstack[0].calls;
    }
    if (this.callstack[0].error !== undefined) {
      result.error = this.callstack[0].error;
    } else if (ctx.error !== undefined) {
      result.error = ctx.error;
    }
    if (
      result.error !== undefined &&
      (result.error !== 'execution reverted' || result.output === '0x')
    ) {
      delete result.output;
    }
    return this.finalize(result);
  }

  private finalize(call) {
    const sorted = {
      type: call.type,
      from: call.from,
      to: call.to,
      value: call.value,
      gas: call.gas,
      gasUsed: call.gasUsed,
      input: call.input,
      output: call.output,
      error: call.error,
      time: call.time,
      calls: call.calls
    };
    for (const key in sorted) {
      if (sorted[key] === undefined) {
        delete sorted[key];
      }
    }
    if (sorted.calls !== undefined) {
      for (let i = 0; i < sorted.calls.length; i++) {
        sorted.calls[i] = this.finalize(sorted.calls[i]);
      }
    }
    return sorted;
  }
}
