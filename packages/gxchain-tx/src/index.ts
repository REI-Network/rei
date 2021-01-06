import { Transaction as EthereumJSTransaction, TxOptions, TxData, JsonTx } from '@ethereumjs/tx';
import { Address, BN, rlp } from 'ethereumjs-util';

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
}
export { TxData, TxOptions, JsonTx };
