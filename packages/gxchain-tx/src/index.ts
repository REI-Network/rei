import { Transaction as EthereumJSTransaction, TxOptions, TxData, JsonTx } from '@ethereumjs/tx';
import { Address, BN, rlp, bufferToHex, bnToHex, intToHex } from 'ethereumjs-util';

export interface BlockLike {
  hash(): Buffer;
  readonly header: {
    number: BN;
  };
}

export class Transaction extends EthereumJSTransaction {
  public static fromTxData(txData: TxData, opts?: TxOptions) {
    return new Transaction(txData, opts);
  }

  public static fromRlpSerializedTx(serialized: Buffer, opts?: TxOptions) {
    const values = rlp.decode(serialized);

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized tx input. Must be array');
    }

    return Transaction.fromValuesArray(values, opts);
  }

  public static fromValuesArray(values: Buffer[], opts?: TxOptions) {
    if (values.length !== 6 && values.length !== 9) {
      throw new Error('Invalid transaction. Only expecting 6 values (for unsigned tx) or 9 values (for signed tx).');
    }

    const [nonce, gasPrice, gasLimit, to, value, data, v, r, s] = values;

    return new Transaction(
      {
        nonce: new BN(nonce),
        gasPrice: new BN(gasPrice),
        gasLimit: new BN(gasLimit),
        to: to && to.length > 0 ? new Address(to) : undefined,
        value: new BN(value),
        data: data || Buffer.from([]),
        v: v ? new BN(v) : undefined,
        r: r ? new BN(r) : undefined,
        s: s ? new BN(s) : undefined
      },
      opts
    );
  }

  blockHash?: Buffer;
  blockNumber?: BN;
  transactionIndex?: number;

  installProperties(block: BlockLike, transactionIndex: number) {
    this.blockHash = block.hash();
    this.blockNumber = block.header.number;
    this.transactionIndex = transactionIndex;
  }

  toRPCJSON() {
    return {
      blockHash: this.blockHash ? bufferToHex(this.blockHash) : undefined,
      blockNumber: this.blockNumber ? bnToHex(this.blockNumber) : undefined,
      from: bufferToHex(this.getSenderAddress().toBuffer()),
      gas: bnToHex(this.gasLimit),
      gasPrice: bnToHex(this.gasPrice),
      hash: bufferToHex(this.hash()),
      input: bufferToHex(this.data),
      nonce: bnToHex(this.nonce),
      to: this.to !== undefined ? this.to.toString() : undefined,
      transactionIndex: this.transactionIndex !== undefined ? intToHex(this.transactionIndex) : undefined,
      value: bnToHex(this.value),
      v: this.v !== undefined ? bnToHex(this.v) : undefined,
      r: this.r !== undefined ? bnToHex(this.r) : undefined,
      s: this.s !== undefined ? bnToHex(this.s) : undefined
    };
  }
}
export { TxData, TxOptions, JsonTx };
