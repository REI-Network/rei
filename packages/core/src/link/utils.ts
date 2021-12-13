import { BN } from 'ethereumjs-util';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
import { Common } from '@rei-network/common';
import { Transaction, Block, Receipt } from '@rei-network/structure';
import { EvidenceFactory } from '../consensus/reimint/types';
import { FinalizeOpts, FinalizeResult, ProcessBlockOpts, ProcessBlockResult, ProcessTxOpts, ProcessTxResult } from '../executor/types';
import { RLPFinalizeOpts, RLPFinalizeResult, RLPProcessBlockOpts, RLPProcessBlockResult, RLPProcessTxOpts, RLPProcessTxResult, CommitBlockOpts, RLPCommitBlockOpts, CommitBlockResult, RLPCommitBlockResult } from './types';

export function toFinalizeOpts(opts: RLPFinalizeOpts, common: Common): FinalizeOpts {
  const block = Block.fromRLPSerializedBlock(opts.block, { common: common.copy(), hardforkByBlockNumber: true });
  const receipts = opts.receipts.map((receipt) => Receipt.fromRlpSerializedReceipt(receipt));
  const evidence = opts.evidence && opts.evidence.map((ev) => EvidenceFactory.fromSerializedEvidence(ev));

  return {
    ...opts,
    block,
    receipts,
    evidence
  };
}

export function fromFinalizeOpts(opts: FinalizeOpts): RLPFinalizeOpts {
  const block = opts.block.serialize();
  const receipts = opts.receipts.map((receipt) => receipt.serialize());
  const evidence = opts.evidence && opts.evidence.map((ev) => EvidenceFactory.serializeEvidence(ev));

  return {
    ...opts,
    block,
    receipts,
    evidence
  };
}

export function toFinalizeResult(result: RLPFinalizeResult): FinalizeResult {
  return result;
}

export function fromFinalizeResult(result: FinalizeResult): RLPFinalizeResult {
  return {
    finalizedStateRoot: result.finalizedStateRoot
  };
}

export function toProcessBlockOpts(opts: RLPProcessBlockOpts, common: Common): ProcessBlockOpts {
  const block = Block.fromRLPSerializedBlock(opts.block, { common: common.copy(), hardforkByBlockNumber: true });

  return {
    ...opts,
    block
  };
}

export function fromProcessBlockOpts(opts: ProcessBlockOpts): RLPProcessBlockOpts {
  const block = opts.block.serialize();

  return {
    ...opts,
    block
  };
}

export function toProcessBlockResult(result: RLPProcessBlockResult): ProcessBlockResult {
  const receipts = result.receipts.map((receipt) => Receipt.fromRlpSerializedReceipt(receipt));

  return { receipts };
}

export function fromProcessBlockResult(result: ProcessBlockResult): RLPProcessBlockResult {
  const receipts = result.receipts.map((receipt) => receipt.serialize());

  return { receipts };
}

export function toProcessTxOpts(opts: RLPProcessTxOpts, common: Common): ProcessTxOpts {
  const block = Block.fromRLPSerializedBlock(opts.block, { common: common.copy(), hardforkByBlockNumber: true });
  const tx = Transaction.fromSerializedTx(opts.tx, { common: block._common });
  const blockGasUsed = opts.blockGasUsed && new BN(opts.blockGasUsed);

  return {
    ...opts,
    block,
    tx,
    blockGasUsed
  };
}

export function fromProcessTxOpts(opts: ProcessTxOpts) {
  const block = opts.block.serialize();
  const tx = opts.tx.serialize();
  const blockGasUsed = opts.blockGasUsed && opts.blockGasUsed.toArrayLike(Buffer);

  return {
    ...opts,
    block,
    tx,
    blockGasUsed
  };
}

export function toProcessTxResult(opts: RLPProcessTxResult): ProcessTxResult {
  const receipt = Receipt.fromRlpSerializedReceipt(opts.receipt);
  const gasUsed = new BN(opts.gasUsed);
  const bloom = new Bloom(opts.bloom);

  return {
    receipt,
    gasUsed,
    bloom
  };
}

export function fromProcessTxResult(opts: ProcessTxResult): RLPProcessTxResult {
  const receipt = opts.receipt.serialize();
  const gasUsed = opts.gasUsed.toArrayLike(Buffer);
  const bloom = opts.bloom.bitvector;

  return {
    receipt,
    gasUsed,
    bloom
  };
}

export function toCommitBlockOpts(opts: RLPCommitBlockOpts, common: Common): CommitBlockOpts {
  const block = Block.fromRLPSerializedBlock(opts.block, { common: common.copy(), hardforkByBlockNumber: true });
  const receipts = opts.receipts.map((receipt) => Receipt.fromRlpSerializedReceipt(receipt));

  return { block, receipts };
}

export function fromCommitBlockOpts(opts: CommitBlockOpts): RLPCommitBlockOpts {
  const block = opts.block.serialize();
  const receipts = opts.receipts.map((receipt) => receipt.serialize());

  return { block, receipts };
}

export function toCommitBlockResult(result: RLPCommitBlockResult): CommitBlockResult {
  return result;
}

export function fromCommitBlockResult(result: CommitBlockResult): RLPCommitBlockResult {
  return result;
}
