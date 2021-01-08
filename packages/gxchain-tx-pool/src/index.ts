import { Transaction } from '@gxchain2/tx';
import BN from 'bn.js';

class FakeTransactionPool {
  private pool: Transaction[] = [];
  put(tx: Transaction) {
    this.pool.push(tx);
    this.pool = this.pool.sort((a, b) => a.gasPrice.sub(b.gasPrice).toNumber());
  }
  get(countLimit: number, totalGasLimit: BN): Transaction[] {
    const arr: Transaction[] = [];
    const gas = new BN(0);
    while (arr.length < countLimit) {
      const tx = this.pool[0];
      if (!tx) {
        break;
      }
      gas.iadd(tx.gasLimit);
      if (gas.gt(totalGasLimit)) {
        break;
      }
      arr.push(this.pool.shift()!);
    }
    return arr;
  }
  forEach(callback: (tx: Transaction, index: number) => void) {
    this.pool.forEach(callback);
  }
}

export { FakeTransactionPool as TransactionPool };
