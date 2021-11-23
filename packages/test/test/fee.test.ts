import { BN } from 'ethereumjs-util';
import { expect } from 'chai';
import { Client } from '../src';

const client = new Client();
const { accMngr, web3 } = client;

const sendTestTransaction = (gasPrice: BN) => {
  return web3.eth.sendTransaction({
    from: accMngr.n2a('test1').toString(),
    to: accMngr.n2a('genesis1').toString(),
    value: 0,
    gas: 21000,
    gasPrice: gasPrice.toString()
  });
};

describe('Fee', () => {
  before(async () => {
    await client.init();

    // transfer amount to test1 and test2 account
    const amount = '1' + '0'.repeat(18); // 1 GXC
    await client.sendTestTransaction(new BN(1), {
      from: 'genesis1',
      to: 'test1',
      value: amount
    });
    await client.sendTestTransaction(new BN(1), {
      from: 'genesis1',
      to: 'test2',
      value: amount
    });
    await client.sendTestTransaction(new BN(1), {
      from: 'genesis1',
      to: 'admin',
      value: amount
    });

    // ensure user balance
    expect(await client.web3.eth.getBalance(accMngr.n2a('test1').toString())).be.equal(amount);
    expect(await client.web3.eth.getBalance(accMngr.n2a('test2').toString())).be.equal(amount);
    // expect(await client.web3.eth.getBalance(accMngr.n2a('admin').toString())).be.equal(amount);

    // update fee recover interval to 1 day
    await client.config.methods.setFeeRecoverInterval(86400).send({ from: accMngr.n2a('admin').toString(), gas: 100000, gasPrice: 1 });
    // update withdraw delay to 1 second
    await client.config.methods.setWithdrawDelay(1).send({ from: accMngr.n2a('admin').toString(), gas: 100000, gasPrice: 1 });
  });

  it('should transfer successfully(1)', async () => {
    const gasPrice = new BN(10);
    const { logs } = await sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);
    expect(feeUsage.eqn(0)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.add(balanceUsage).eq(gasPrice.muln(21000))).be.true;
  });

  it('should stack successfully', async () => {
    // let test2 deposit for test1
    await client.fee.methods.deposit(accMngr.n2a('test1').toString()).send({
      from: accMngr.n2a('test2').toString(),
      value: 100,
      gas: 1000000,
      gasPrice: 1
    });

    expect(await client.fee.methods.userTotalAmount(accMngr.n2a('test1').toString()).call()).be.equal('100');
  });

  it('should transfer successfully(2)', async () => {
    const gasPrice = new BN(10);
    const { logs } = await sendTestTransaction(gasPrice);
    expect(logs.length > 0).be.true;

    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);
    expect(feeUsage.eq(gasPrice.muln(21000))).be.true;
    expect(freeFeeUsage.eqn(0)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eqn(0)).be.true;
  });

  it('should transfer successfully(3)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const left = new BN(await client.fee.methods.estimateFee(accMngr.n2a('test1').toString(), now).call());

    const gasPrice = left.divn(21000 - 1);
    const gasUsed = gasPrice.muln(21000);
    const feeUsed = left.clone();

    // due to the time difference, there may be a certain error
    const feeUsedMax = feeUsed.muln(101).divn(100);
    const feeUsedMin = feeUsed.muln(99).divn(100);

    const { logs } = await sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);
    expect(feeUsage.gte(feeUsedMin) && feeUsage.lte(feeUsedMax)).be.true;
    expect(freeFeeUsage.add(balanceUsage).eq(gasUsed.sub(feeUsage))).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
  });
});
