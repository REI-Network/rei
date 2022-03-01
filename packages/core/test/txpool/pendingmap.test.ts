import { expect } from 'chai';
import { Address } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Transaction } from '@rei-network/structure';
import { PendingTxMap } from '../../src/txpool';

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

function genMockTx(sender: Buffer, gasPrice: number) {
  const tx = Transaction.fromTxData({ gasPrice }, { common });
  (tx as any).__sender = new Address(sender);
  (tx as any).__proto__.getSenderAddress = function (this: Transaction) {
    return (this as any).__sender;
  };
  return tx;
}

describe('PendingTxMap', () => {
  const map = new PendingTxMap();

  const sender1 = Buffer.from('00'.repeat(20), 'hex');
  const sortedTxs1 = [genMockTx(sender1, 3), genMockTx(sender1, 5), genMockTx(sender1, 8)].sort((tx1, tx2) => tx2.gasPrice.cmp(tx1.gasPrice));

  const sender2 = Buffer.from('11'.repeat(20), 'hex');
  const sortedTxs2 = [genMockTx(sender2, 4), genMockTx(sender2, 6), genMockTx(sender2, 7)].sort((tx1, tx2) => tx2.gasPrice.cmp(tx1.gasPrice));

  it('should push succeed', () => {
    map.push(sender1, sortedTxs1);
    map.push(sender2, sortedTxs2);
  });

  it('should peek succeed', () => {
    const expectTxs = [...sortedTxs2, ...sortedTxs1].sort((tx1, tx2) => tx2.gasPrice.cmp(tx1.gasPrice));
    let tx: Transaction | undefined;
    while ((tx = map.peek())) {
      const _tx = expectTxs.shift()!;
      expect(tx === _tx).be.true;
      map.shift();
    }
    expect(expectTxs.length).be.equal(0);
  });
});
