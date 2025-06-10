import { expect } from 'chai';
import { Address, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Transaction } from '@rei-network/structure';
import { PendingTxMap } from '../../src/txpool';

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

function genMockTx(privateKey: Buffer, gasPrice: number) {
  return Transaction.fromTxData({ gasPrice }, { common }).sign(privateKey);
}

describe('PendingTxMap', () => {
  const map = new PendingTxMap();

  const privateKey1 = toBuffer(
    '0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0'
  );
  const sender1 = Address.fromPrivateKey(privateKey1);
  const sortedTxs1 = [
    genMockTx(privateKey1, 3),
    genMockTx(privateKey1, 5),
    genMockTx(privateKey1, 8)
  ].sort((tx1, tx2) => tx2.gasPrice.cmp(tx1.gasPrice));

  const privateKey2 = toBuffer(
    '0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c1'
  );
  const sender2 = Address.fromPrivateKey(privateKey2);
  const sortedTxs2 = [
    genMockTx(privateKey2, 4),
    genMockTx(privateKey2, 6),
    genMockTx(privateKey2, 7)
  ].sort((tx1, tx2) => tx2.gasPrice.cmp(tx1.gasPrice));

  it('should push succeed', () => {
    map.push(sender1.buf, sortedTxs1);
    map.push(sender2.buf, sortedTxs2);
  });

  it('should peek succeed', () => {
    const expectTxs = [...sortedTxs2, ...sortedTxs1].sort((tx1, tx2) =>
      tx2.gasPrice.cmp(tx1.gasPrice)
    );
    let tx: Transaction | undefined;
    while ((tx = map.peek())) {
      const _tx = expectTxs.shift()!;
      expect(tx === _tx).be.true;
      map.shift();
    }
    expect(expectTxs.length).be.equal(0);
  });
});
