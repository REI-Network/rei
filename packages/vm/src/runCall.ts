import { Address, BN, generateAddress } from 'ethereumjs-util';
import VM from '@ethereumjs/vm';
import TxContext from '@ethereumjs/vm/dist/evm/txContext';
import Message from '@ethereumjs/vm/dist/evm/message';
import { default as EVM, EVMResult } from '@ethereumjs/vm/dist/evm/evm';
import { RunCallOpts } from '@ethereumjs/vm/dist/runCall';
import { InterpreterStep } from '@ethereumjs/vm/dist/evm/interpreter';
import { Block } from '@gxchain2/structure';
import { IDebug } from './types';

export interface RunCallDebugOpts extends RunCallOpts {
  debug?: IDebug;
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

  // Update from account's nonce and balance
  const state = this.stateManager;
  let fromAccount = await state.getAccount(message.caller);
  fromAccount.nonce.iaddn(1);
  await state.putAccount(message.caller, fromAccount);

  let time: undefined | number;
  let lastStep: undefined | InterpreterStep;
  let handler: undefined | ((step: InterpreterStep, next: () => void) => void);
  if (opts.debug) {
    handler = async (step: InterpreterStep, next: () => void) => {
      if (lastStep !== undefined) {
        await opts.debug!.captureState(lastStep, lastStep.gasLeft.sub(step.gasLeft));
      }
      lastStep = step;
      next();
    };
    this.on('step', handler);
    time = Date.now();
    await opts.debug.captureStart(message?.caller?.buf, message?.to?.buf || generateAddress(message.caller.buf, fromAccount.nonce.subn(1).toArrayLike(Buffer)), message.to === undefined, message.data, message.gasLimit, new BN(0), new BN(0), message.value, block.header.number, this.stateManager);
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
    if (lastStep) {
      if (result?.execResult.exceptionError) {
        await opts.debug.captureFault(lastStep, new BN(lastStep.opcode.fee), result.execResult.exceptionError);
      } else if (catchedErr !== undefined) {
        await opts.debug.captureFault(lastStep, new BN(lastStep.opcode.fee), catchedErr);
      } else {
        await opts.debug.captureState(lastStep, new BN(lastStep.opcode.fee));
      }
    }
    if (result) {
      await opts.debug.captureEnd(result.execResult.returnValue, result.gasUsed, Date.now() - time!);
    } else {
      await opts.debug.captureEnd(Buffer.alloc(0), new BN(0), Date.now() - time!);
    }
  }

  if (!result) {
    throw catchedErr;
  }
  return result;
}
