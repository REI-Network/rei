import { BN } from 'ethereumjs-util';
import { expect } from 'chai';
import { Client } from '../src';

const client = new Client();
const { accMngr, web3 } = client;

const sendTestTransaction = (nonce: number) => {
  return web3.eth.sendTransaction({
    from: accMngr.n2a('test1').toString(),
    to: accMngr.n2a('genesis1').toString(),
    value: 0,
    gas: 21000,
    gasPrice: 1,
    nonce
  });
};

describe('Concurency', () => {
  before(async () => {
    await client.init();

    const amount = '1' + '0'.repeat(18); // 1 REI
    await client.sendTestTransaction(new BN(1), {
      from: 'genesis1',
      to: 'test1',
      value: amount
    });

    // ensure user balance
    expect(await web3.eth.getBalance(accMngr.n2a('test1').toString())).be.equal(amount);
  });

  let latestTimestamp = 0;
  let totalTxs = 0;
  let totalUsed = 0;
  let totalUsage = 0;
  let totalBlocks = 0;
  web3.eth.subscribe('newBlockHeaders', async (error, blockHeader) => {
    const txs = await web3.eth.getBlockTransactionCount(blockHeader.number);
    const usage = latestTimestamp !== 0 ? (blockHeader.timestamp as number) - latestTimestamp : 0;

    if (txs > 0 && usage !== 0) {
      totalTxs += txs;
      totalUsed += blockHeader.gasUsed;
      totalUsage += usage;
      totalBlocks++;
      console.log('block:', blockHeader.number, 'avgTxs:', Math.floor(totalTxs / totalBlocks), 'avgGasUsed:', Math.floor(totalUsed / totalBlocks), 'avgUsage:', Math.floor(totalUsage / totalBlocks));
    }

    if (txs > 0) {
      latestTimestamp = blockHeader.timestamp as number;
    }
  });

  it('concurrency', async () => {
    let nonce = await web3.eth.getTransactionCount(accMngr.n2a('test1').toString());
    let ps: Promise<any>[] = [];
    const sendOnce = async () => {
      ps.push(sendTestTransaction(nonce++));
      if (ps.length >= 100) {
        console.log('tx too many, await');
        await Promise.all(ps);
        console.log('tx clear up');
        ps = [];
      }
    };

    for (let i = 0; i < 1000; i++) {
      await sendOnce();
    }

    await Promise.all(ps);
  });
});
