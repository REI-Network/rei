import { Address, BN } from 'ethereumjs-util';
import { Block } from '@ethereumjs/block';
import VM from '@ethereumjs/vm';
import TxContext from '@ethereumjs/vm/dist/evm/txContext';
import Message from '@ethereumjs/vm/dist/evm/message';
import { default as EVM, EVMResult } from '@ethereumjs/vm/dist/evm/evm';
import { RunCallOpts } from '@ethereumjs/vm/dist/runCall';
import { InterpreterStep } from '@ethereumjs/vm/dist/evm/interpreter';
import { DebugOpts } from './types';

export interface RunCallDebugOpts extends RunCallOpts {
  debug?: DebugOpts;
}

/**
 * @ignore
 */
export default async function runCall(this: VM, opts: RunCallDebugOpts): Promise<EVMResult> {
  const block = opts.block || new Block();

  const txContext = new TxContext(opts.gasPrice || new BN(0), opts.origin || opts.caller || Address.zero());
  const message = new Message({
    caller: opts.caller,
    gasLimit: opts.gasLimit ? opts.gasLimit : new BN(0xffffff),
    to: opts.to ? opts.to : undefined,
    value: opts.value,
    data: opts.data,
    code: opts.code,
    depth: opts.depth || 0,
    isCompiled: opts.compiled || false,
    isStatic: opts.static || false,
    salt: opts.salt || null,
    selfdestruct: opts.selfdestruct || {},
    delegatecall: opts.delegatecall || false
  });

  let time: undefined | number;
  let lastStep: undefined | InterpreterStep;
  let handler: undefined | ((step: InterpreterStep, next: () => void) => void);
  if (opts.debug) {
    handler = (step: InterpreterStep, next: () => void) => {
      if (lastStep !== undefined) {
        opts.debug!.captureState(lastStep);
      }
      lastStep = step;
      next();
    };
    this.on('step', handler);
    time = Date.now();
    opts.debug.captureStart(message.caller ? message.caller : Address.zero(), message.to === undefined, message.data, message.gasLimit, message.value, message.to);
  }

  let result: undefined | EVMResult;
  let catchedErr: any;
  try {
    const evm = new EVM(this, txContext, block);
    result = await evm.executeMessage(message);
  } catch (err) {
    catchedErr = err;
  }

  // Remove Listener
  if (handler) {
    this.removeListener('step', handler);
  }

  // Call tx exec over
  if (opts.debug) {
    // lastStep logically must exist here
    if (result?.execResult.exceptionError) {
      opts.debug.captureFault(lastStep!, result.execResult.exceptionError);
    } else if (catchedErr !== undefined) {
      opts.debug.captureFault(lastStep!, catchedErr);
    } else {
      opts.debug.captureState(lastStep!);
    }
    if (result) {
      opts.debug.captureEnd(result.execResult.returnValue, result.gasUsed, Date.now() - time!);
    } else {
      opts.debug.captureEnd(Buffer.alloc(0), new BN(0), Date.now() - time!);
    }
  }

  if (!result) {
    throw catchedErr;
  }
  return result;
}
