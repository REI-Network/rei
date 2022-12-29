import { Address, BN, generateAddress } from 'ethereumjs-util';
import { Block } from '@rei-network/structure';
import { VM } from './index';
import TxContext from './evm/txContext';
import Message from './evm/message';
import type { IDebug } from './types';
import { default as EVM, EVMResult } from './evm/evm';

/**
 * Options for running a call (or create) operation
 */
export interface RunCallOpts {
  block?: Block;
  gasPrice?: BN;
  origin?: Address;
  caller?: Address;
  gasLimit?: BN;
  to?: Address;
  value?: BN;
  data?: Buffer;
  /**
   * This is for CALLCODE where the code to load is different than the code from the `opts.to` address.
   */
  code?: Buffer;
  depth?: number;
  compiled?: boolean;
  static?: boolean;
  salt?: Buffer;
  selfdestruct?: { [k: string]: boolean };
  delegatecall?: boolean;
  debug?: IDebug;
}

/**
 * @ignore
 */
export default async function runCall(this: VM, opts: RunCallOpts): Promise<EVMResult> {
  const block = opts.block ?? Block.fromBlockData({}, { common: this._common });

  // load recent hashes
  const recentHashes: Buffer[] = [];
  const number = block.header.number;
  const db = this.blockchain.database;
  for (let i = number.subn(1); i.gten(0) && i.gte(number.subn(256)); i.isubn(1)) {
    recentHashes.push(await db.numberToHash(i));
  }

  // calculate block miner address
  let author: Address | undefined = undefined;
  if (this._getMiner) {
    author = this._getMiner(block.header);
  }

  const txContext = new TxContext(opts.gasPrice ?? new BN(0), opts.origin ?? opts.caller ?? Address.zero(), author, undefined, undefined, recentHashes);

  const message = new Message({
    caller: opts.caller,
    gasLimit: opts.gasLimit ?? new BN(0xffffff),
    to: opts.to ?? undefined,
    value: opts.value,
    data: opts.data,
    code: opts.code,
    depth: opts.depth ?? 0,
    isCompiled: opts.compiled ?? false,
    isStatic: opts.static ?? false,
    salt: opts.salt ?? null,
    selfdestruct: opts.selfdestruct ?? {},
    delegatecall: opts.delegatecall ?? false
  });

  // Update from account's nonce and balance
  const state = this.stateManager;
  const fromAccount = await state.getAccount(message.caller);
  fromAccount.nonce.iaddn(1);
  await state.putAccount(message.caller, fromAccount);

  let time: undefined | number;
  if (opts.debug) {
    time = Date.now();
    const from = message?.caller?.buf;
    const to = message?.to?.buf ?? generateAddress(message.caller.buf, fromAccount.nonce.subn(1).toArrayLike(Buffer));
    const create = message.to === undefined;
    const input = message.data;
    const gas = message.gasLimit;
    const gasPrice = new BN(0);
    const value = message.value;
    const number = block.header.number;
    await opts.debug!.captureStart(from, to, create, input, gas, gasPrice, value, number, this.stateManager);
  }

  let result: undefined | EVMResult;
  let catchedErr: any;
  try {
    const evm = new EVM(this, txContext, block, opts.debug);
    result = await evm.executeMessage(message);
  } catch (err) {
    catchedErr = err;
  }

  // Call tx exec over
  if (opts.debug) {
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
