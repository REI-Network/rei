import { FunctionalMap } from '@gxchain2/utils';
import { Transaction } from '@gxchain2/tx';
import { TxSortedMap } from './txmap';

export interface TxPoolOptions {
  txMaxSize?: number;

  priceLimit?: number;
  priceBump?: number;

  accountSlots?: number;
  globalSlots?: number;
  accountQueue?: number;
  globalQueue?: number;
}

export class TxPool {
  private readonly pending: FunctionalMap<Buffer, TxSortedMap>;
  private readonly queue: FunctionalMap<Buffer, TxSortedMap>;

  private readonly options: TxPoolOptions;
  constructor(options: TxPoolOptions) {
    this.options = options;
    const makeMap = () =>
      new FunctionalMap<Buffer, TxSortedMap>((a, b) => {
        if (a.length < b.length) {
          return -1;
        }
        if (a.length > b.length) {
          return 1;
        }
        for (let i = 0; i < a.length; i++) {
          if (a[i] < b[i]) {
            return -1;
          }
          if (a[i] > b[i]) {
            return 1;
          }
        }
        return 0;
      });
    this.pending = makeMap();
    this.queue = makeMap();
  }

  private enqueueTx(tx: Transaction): boolean {
    const sender = tx.getSenderAddress().buf;
    let sortedMap = this.queue.get(sender);
    if (!sortedMap) {
      sortedMap = new TxSortedMap(false);
      const { inserted } = sortedMap.push(tx);
      this.queue.set(sender, sortedMap);
    }
    const { inserted, old } = sortedMap.push(tx);
    if (old) {
      // removeTx
    }
    return inserted;
  }
}
