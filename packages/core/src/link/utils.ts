import { BN, Address } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Transaction, Block } from '@rei-network/structure';
import { RunTxOpts } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { RunCallOpts } from '@gxchain2-ethereumjs/vm/dist/runCall';
import { RunCallArgs, RunTxArgs } from './types';

export function bufferToAddress(buffer: Buffer | undefined) {
  return buffer && new Address(buffer);
}

export function bufferToBN(buffer: Buffer | undefined) {
  return buffer && new BN(buffer);
}

export function bufferToBlock(buffer: Buffer | undefined, common: Common) {
  return (
    buffer &&
    Block.fromRLPSerializedBlock(buffer, {
      common: common.copy(),
      hardforkByBlockNumber: true
    })
  );
}

export function toRunTxOpts(args: RunTxArgs, common: Common): RunTxOpts {
  const tx = Transaction.fromSerializedTx(args.tx, { common: common.copy() });
  const block = bufferToBlock(args.block, common);
  const blockGasUsed = bufferToBN(args.blockGasUsed);
  return {
    ...args,
    tx,
    block,
    blockGasUsed
  };
}

export function toRunCallOpts(args: RunCallArgs, common: Common): RunCallOpts {
  const block = bufferToBlock(args.block, common);
  const gasPrice = bufferToBN(args.gasPrice);
  const origin = bufferToAddress(args.origin);
  const caller = bufferToAddress(args.caller);
  const gasLimit = bufferToBN(args.gasLimit);
  const to = bufferToAddress(args.to);
  const value = bufferToBN(args.value);

  return {
    ...args,
    block,
    gasPrice,
    origin,
    caller,
    gasLimit,
    to,
    value
  };
}

export function fromRunTxOpts(opts: RunTxOpts, _number: BN, root: Buffer): RunTxArgs {
  const tx = opts.tx.serialize();
  const block = opts.block?.serialize();
  const blockGasUsed = opts.blockGasUsed?.toArrayLike(Buffer);
  const number = _number.toArrayLike(Buffer);
  return {
    ...opts,
    tx,
    block,
    blockGasUsed,
    number,
    root
  };
}

export function fromRunCallOpts(opts: RunCallOpts, _number: BN, root: Buffer): RunCallArgs {
  const block = opts.block?.serialize();
  const gasPrice = opts.gasPrice?.toArrayLike(Buffer);
  const origin = opts.origin?.buf;
  const caller = opts.caller?.buf;
  const gasLimit = opts.gasLimit?.toArrayLike(Buffer);
  const to = opts.to?.buf;
  const value = opts.value?.toArrayLike(Buffer);
  const number = _number.toArrayLike(Buffer);

  return {
    ...opts,
    block,
    gasPrice,
    origin,
    caller,
    gasLimit,
    to,
    value,
    number,
    root
  };
}
