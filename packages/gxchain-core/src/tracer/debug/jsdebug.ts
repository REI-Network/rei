import vm from 'vm';
import { Address, BN, bufferToHex, setLengthLeft, generateAddress, generateAddress2, keccak256 } from 'ethereumjs-util';
import { InterpreterStep, VmError } from '@gxchain2/vm';
import { IDebugImpl } from '../tracer';
import { StateManager } from '@ethereumjs/vm/dist/state';
import d from 'deasync';
import { hexStringToBuffer, logger } from '@gxchain2/utils';

function deasync<T>(p: Promise<T>): T {
  let result: undefined | T;
  let error: any;
  p.then((res) => (result = res)).catch((err) => (error = err));
  while (result === undefined && error === undefined) {
    d.sleep(10);
  }
  if (error) {
    throw error;
  }
  return result!;
}

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
      return BigInt(0);
    }
    return this.memory.slice(offset, offset + 32).readUInt32BE();
  }
}

class Contract {
  caller: Buffer;
  address: Buffer;
  value: BigInt;
  input: Buffer;
  constructor(caller: Buffer, address: Buffer, value: BigInt, input: Buffer) {
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
    getBalance(address: Buffer) {
      try {
        return BigInt(deasync(stateManager.getAccount(new Address(address))).balance.toString());
      } catch (err) {
        logger.warn('JSDebug_DB::getBalance, catch error:', err);
        return BigInt(0);
      }
    },
    getNonce(address: Buffer) {
      try {
        return deasync(stateManager.getAccount(new Address(address))).nonce.toNumber();
      } catch (err) {
        logger.warn('JSDebug_DB::getNonce, catch error:', err);
        return 0;
      }
    },
    getCode(address: Buffer) {
      try {
        return deasync(stateManager.getContractCode(new Address(address)));
      } catch (err) {
        logger.warn('JSDebug_DB::getCode, catch error:', err);
        return Buffer.alloc(0);
      }
    },
    getState(address: Buffer, hash: Buffer) {
      try {
        return deasync(stateManager.getContractStorage(new Address(address), hash));
      } catch (err) {
        logger.warn('JSDebug_DB::getState, catch error:', err);
        return Buffer.alloc(0);
      }
    },
    exists(address: Buffer) {
      try {
        return deasync(stateManager.accountExists(new Address(address)));
      } catch (err) {
        logger.warn('JSDebug_DB::exists, catch error:', err);
        return false;
      }
    }
  };
}

function makeLog(ctx: { [key: string]: any }, step: InterpreterStep, cost: BN, error?: string) {
  const stack = step.stack.map((bn) => BigInt(bn.toString()));
  Object.defineProperty(stack, 'peek', {
    value: (idx: number) => {
      if (idx < 0 || idx > stack.length - 1) {
        return BigInt(0);
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
      return step.depth;
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
  private debugContext: {
    [key: string]: any;
  } = {};
  private vmContextObj: {
    toHex(buf: Buffer): string;
    toWord(data: Buffer | string): Buffer;
    toAddress(data: Buffer | string): Buffer;
    toContract(data: Buffer | string, nonce: number): Buffer;
    toContract2(data: Buffer | string, salt: string, code: Buffer): Buffer;
    globalLog?: ReturnType<typeof makeLog>;
    globalDB?: ReturnType<typeof makeDB>;
    globalCtx: { [key: string]: any };
    globalReturnValue?: any;
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
    globalCtx: this.debugContext
  };
  private vmContext: vm.Context;

  constructor(code: string) {
    this.vmContext = vm.createContext(this.vmContextObj, { codeGeneration: { strings: false, wasm: false } });
    new vm.Script(`const obj = ${code}`).runInContext(this.vmContext);
  }

  async captureStart(from: undefined | Buffer, to: undefined | Buffer, create: boolean, input: Buffer, gas: BN, value: BN, number: BN, stateManager: StateManager) {
    this.debugContext['type'] = create ? 'CREAT' : 'CALL';
    this.debugContext['from'] = from;
    this.debugContext['to'] = to;
    this.debugContext['input'] = input;
    this.debugContext['gas'] = gas.toNumber();
    this.debugContext['value'] = BigInt(value.toString());
    this.debugContext['block'] = number.toNumber();
    this.vmContextObj.globalDB = makeDB(stateManager);
  }

  private captureLog(step: InterpreterStep, cost: BN, error?: string) {
    this.vmContextObj.globalLog = makeLog(this.debugContext, step, cost, error);
    error ? new vm.Script('obj.fault.call(obj, globalLog, globalDB)').runInContext(this.vmContext) : new vm.Script('obj.step.call(obj, globalLog, globalDB)').runInContext(this.vmContext);
  }

  async captureState(step: InterpreterStep, cost: BN) {
    this.captureLog(step, cost);
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
    this.captureLog(step, cost, errString);
  }

  async captureEnd(output: Buffer, gasUsed: BN, time: number) {
    this.debugContext['output'] = output;
    this.debugContext['gasUsed'] = gasUsed.toNumber();
    this.debugContext['time'] = time;
  }

  result() {
    new vm.Script('globalReturnValue = obj.result.call(obj, globalCtx, globalDB)').runInContext(this.vmContext);
    return this.vmContextObj.globalReturnValue;
  }
}
