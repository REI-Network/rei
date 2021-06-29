import { bnToHex, bufferToHex, BN, Address } from 'ethereumjs-util';
import { Block } from '@ethereumjs/block';
import { CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN } from '@ethereumjs/block/dist/clique';
import { txSize, WrappedTransaction } from './transaction';

/**
 * Calculate clique difficulty and `inturn` , if `inturn` is true,
 * generate a block with a difficulty of 2, else generate a block
 * with a difficulty of 1
 * @param activeSigners Actives Singers now
 * @param signer All singers
 * @param number The block number
 * @returns The object of inTurn and difficulty
 */
export function calcCliqueDifficulty(activeSigners: Address[], signer: Address, number: BN): [boolean, BN] {
  if (activeSigners.length === 0) {
    throw new Error('Missing active signers information');
  }
  const signerIndex = activeSigners.findIndex((address: Address) => address.equals(signer));
  const inTurn = signerIndex !== -1 && number.modn(activeSigners.length) === signerIndex;
  return [inTurn, (inTurn ? CLIQUE_DIFF_INTURN : CLIQUE_DIFF_NOTURN).clone()];
}

/**
 * WrappedBlock based on `@ethereumjs/block`
 */
export class WrappedBlock {
  readonly block: Block;
  private readonly isPending: boolean;
  private _size?: number;

  constructor(block: Block, isPending: boolean = false) {
    this.block = block;
    this.isPending = isPending;
  }

  /**
   * Get the size of the total block
   */
  get size() {
    if (this._size) {
      return this._size;
    }
    this._size = this.block.header.raw().length;
    for (const tx of this.block.transactions) {
      this._size += txSize(tx);
    }
    return this._size;
  }

  /**
   * Convert the block into json form for use by the rpc port
   * @param fullTransactions Whether to load all transaction information
   * @returns
   */
  toRPCJSON(fullTransactions: boolean = false) {
    return {
      number: this.isPending ? null : bnToHex(this.block.header.number),
      hash: this.isPending ? null : bufferToHex(this.block.hash()),
      parentHash: bufferToHex(this.block.header.parentHash),
      nonce: this.isPending ? null : bufferToHex(this.block.header.nonce),
      sha3Uncles: bufferToHex(this.block.header.uncleHash),
      logsBloom: this.isPending ? null : bufferToHex(this.block.header.bloom),
      transactionsRoot: bufferToHex(this.block.header.transactionsTrie),
      stateRoot: bufferToHex(this.block.header.stateRoot),
      receiptsRoot: bufferToHex(this.block.header.receiptTrie),
      miner: this.block.header.coinbase.toString(),
      mixHash: bufferToHex(this.block.header.mixHash),
      difficulty: bnToHex(this.block.header.difficulty),
      totalDifficulty: bnToHex(this.block.header.number),
      extraData: bufferToHex(this.block.header.extraData),
      size: bnToHex(new BN(this.size)),
      gasLimit: bnToHex(this.block.header.gasLimit),
      gasUsed: bnToHex(this.block.header.gasUsed),
      timestamp: bnToHex(this.block.header.timestamp),
      transactions: fullTransactions
        ? this.block.transactions.map((tx, i) => {
            const wtx = new WrappedTransaction(tx);
            wtx.installProperties(this.block, i);
            return wtx.toRPCJSON();
          })
        : this.block.transactions.map((tx) => bufferToHex(tx.hash())),
      uncles: this.block.uncleHeaders.map((uh) => bufferToHex(uh.hash()))
    };
  }
}

export * from '@ethereumjs/block';
export { CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN };
