import { bnToHex, bufferToHex, BN, Address } from 'ethereumjs-util';
import { Block, Blockchain, BlockHeader } from '@ethereumjs/block';
import { CLIQUE_EXTRA_VANITY, CLIQUE_EXTRA_SEAL, CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN } from '@ethereumjs/block/dist/clique';
import { txSize, WrappedTransaction } from '@gxchain2/tx';

export async function validateBlock(this: Block, blockchain: Blockchain) {
  await validateBlockHeader.call(this.header, blockchain);
  await this.validateUncles(blockchain);
  await this.validateData();
}

export async function validateBlockHeader(this: BlockHeader, blockchain: Blockchain, height?: BN) {
  if (this.isGenesis()) {
    return;
  }
  const hardfork = (this as any)._getHardfork();
  if (this._common.consensusAlgorithm() !== 'clique') {
    if (this.extraData.length > this._common.paramByHardfork('vm', 'maxExtraDataSize', hardfork)) {
      const msg = 'invalid amount of extra data';
      throw this._error(msg);
    }
  } else {
    const minLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL;
    if (!this.cliqueIsEpochTransition()) {
      // ExtraData length on epoch transition
      if (this.extraData.length !== minLength) {
        const msg = `extraData must be ${minLength} bytes on non-epoch transition blocks, received ${this.extraData.length} bytes`;
        throw this._error(msg);
      }
    } else {
      const signerLength = this.extraData.length - minLength;
      if (signerLength % 20 !== 0) {
        const msg = `invalid signer list length in extraData, received signer length of ${signerLength} (not divisible by 20)`;
        throw this._error(msg);
      }
      // coinbase (beneficiary) on epoch transition
      if (!this.coinbase.isZero()) {
        const msg = `coinbase must be filled with zeros on epoch transition blocks, received ${this.coinbase.toString()}`;
        throw this._error(msg);
      }
    }
    // MixHash format
    if (!this.mixHash.equals(Buffer.alloc(32))) {
      const msg = `mixHash must be filled with zeros, received ${this.mixHash}`;
      throw this._error(msg);
    }
    if (!this.validateCliqueDifficulty(blockchain)) {
      const msg = 'invalid clique difficulty';
      throw this._error(msg);
    }
  }

  const parentHeader = await (this as any)._getHeaderByHash(blockchain, this.parentHash);

  if (!parentHeader) {
    throw new Error('could not find parent header');
  }

  const { number } = this;
  if (!number.eq(parentHeader.number.addn(1))) {
    throw new Error('invalid number');
  }

  if (this.timestamp.lte(parentHeader.timestamp)) {
    throw new Error('invalid timestamp');
  }

  if (this._common.consensusAlgorithm() === 'clique') {
    const period = this._common.consensusConfig().period;
    // Timestamp diff between blocks is lower than PERIOD (clique)
    if (parentHeader.timestamp.addn(period).gt(this.timestamp)) {
      throw new Error('invalid timestamp diff (lower than period)');
    }
  }

  // skip consensus check
  // if (this._common.consensusType() === 'pow') {
  //   if (!this.validateDifficulty(parentHeader)) {
  //     throw new Error('invalid difficulty');
  //   }
  // }

  if (!this.validateGasLimit(parentHeader)) {
    throw new Error('invalid gas limit');
  }

  if (height) {
    const dif = height.sub(parentHeader.number);
    if (!(dif.ltn(8) && dif.gtn(1))) {
      throw new Error('uncle block has a parent that is too old or too young');
    }
  }
}

export function calcCliqueDifficulty(activeSigners: Address[], signer: Address, number: BN) {
  if (activeSigners.length === 0) {
    throw new Error('Missing active signers information');
  }
  const signerIndex = activeSigners.findIndex((address: Address) => address.equals(signer));
  const inTurn = number.modn(activeSigners.length) === signerIndex;
  return (inTurn ? CLIQUE_DIFF_INTURN : CLIQUE_DIFF_NOTURN).clone();
}

export class WrappedBlock {
  readonly block: Block;
  private readonly isPending: boolean;
  private _size?: number;

  constructor(block: Block, isPending: boolean = false) {
    this.block = block;
    this.isPending = isPending;
  }

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
