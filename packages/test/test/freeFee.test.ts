import { BN } from 'ethereumjs-util';
import { expect } from 'chai';
import { Client } from '../src';

const client = new Client();
const { accMngr, web3 } = client;

let userFreeFeeLimit!: BN;

describe('Free fee', () => {
  before(async () => {
    await client.init();

    // transfer amount to the test1 account
    const amount = '1' + '0'.repeat(18); // 1 GXC
    await client.sendTestTransaction(new BN(1), {
      from: 'genesis1',
      to: 'test1',
      value: amount
    });

    // ensure user balance
    expect(await web3.eth.getBalance(accMngr.n2a('test1').toString())).be.equal(amount);

    // load config
    userFreeFeeLimit = new BN(await client.config.methods.userFreeFeeLimit().call());

    // update free fee recover interval to 1 day
    await client.config.methods.setFreeFeeRecoverInterval(86400).send({ from: accMngr.n2a('admin').toString(), gas: 100000, gasPrice: 1 });
  });

  it('should transfer successfully(1)', async () => {
    expect((await client.freeFee.methods.userUsage(accMngr.n2a('test1').toString()).call()).usage).be.equal('0');

    const gasPrice = new BN(10);
    const { logs } = await client.sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);
    expect(feeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.eq(gasPrice.muln(21000))).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eqn(0)).be.true;
  });

  it('should transfer successfully(2)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const left = new BN(await client.freeFee.methods.estimateFreeFee(accMngr.n2a('test1').toString(), now).call());

    const gasPrice = left.divn(21000 - 1);
    const gasUsed = gasPrice.muln(21000);
    const freeFeeUsed = left.clone();
    const balanceUsed = gasUsed.sub(freeFeeUsed);
    const { logs } = await client.sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);

    expect(feeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.eq(freeFeeUsed)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eq(balanceUsed)).be.true;
  });

  it('should transfer successfully(3)', async () => {
    const gasPrice = new BN(1);
    const { logs } = await client.sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);

    expect(feeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.eqn(0)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eq(gasPrice.muln(21000))).be.true;
  });
});
