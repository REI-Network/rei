import { BN } from 'ethereumjs-util';
import { expect } from 'chai';
import { Client } from '../src';

const client = new Client();
const { accMngr, web3 } = client;

const sendTestTransaction = (nonce: number, from?: string) => {
  return web3.eth.sendTransaction({
    from: from ?? accMngr.n2a('test1').toString(),
    to: accMngr.n2a('genesis1').toString(),
    value: 0,
    gas: 21000,
    gasPrice: 1,
    nonce
  });
};

describe('Fee', () => {
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

  it("should use user's balance when crude is 0", async () => {
    const nonce = await web3.eth.getTransactionCount(accMngr.n2a('test1').toString());
    const receipt = await sendTestTransaction(nonce);
    const { feeUsage, balanceUsage } = client.parseUsageInfo(receipt);

    expect(feeUsage.toNumber(), 'fee usage should be equal').be.equal(0);
    expect(balanceUsage.toNumber(), 'balance usage should be equal').be.equal(21000);
  });

  it('should deposit succeed(1)', async () => {
    const genesis1 = accMngr.n2a('genesis1').toString();
    const test1 = accMngr.n2a('test1').toString();
    const value = 100;
    const gas = await client.fee.methods.deposit(test1).estimateGas({
      from: genesis1,
      value
    });
    await client.fee.methods.deposit(test1).send({
      from: genesis1,
      value,
      gas
    });

    const crude = new BN(await client.feeToken.methods.balanceOf(test1).call());
    expect(crude.gtn(0), "test1 account's crude should be greater than 0").be.true;
  });

  it("should use user's balance and crude", async () => {
    const nonce = await web3.eth.getTransactionCount(accMngr.n2a('test1').toString());
    const receipt = await sendTestTransaction(nonce);
    const { feeUsage, balanceUsage } = client.parseUsageInfo(receipt);
    const totalUsage = feeUsage.add(balanceUsage);

    expect(feeUsage.gtn(0), 'fee usage should be greater than 0').be.true;
    expect(totalUsage.toNumber(), 'total usage should be equal').be.equal(21000);
  });

  it('should deposit succeed(2)', async () => {
    const genesis1 = accMngr.n2a('genesis1').toString();
    const test0 = accMngr.n2a('test0').toString();
    const value = 100;
    const gas = await client.fee.methods.deposit(test0).estimateGas({
      from: genesis1,
      value
    });
    await client.fee.methods.deposit(test0).send({
      from: genesis1,
      value,
      gas
    });

    const crude = new BN(await client.feeToken.methods.balanceOf(test0).call());
    expect(crude.gtn(0), "test0 account's crude should be greater than 0").be.true;
  });

  it("should send tx succeed when user's balance is 0", async () => {
    const test0 = accMngr.n2a('test0').toString();
    const nonce = await web3.eth.getTransactionCount(test0);
    const receipt = await sendTestTransaction(nonce, test0);
    const { feeUsage, balanceUsage } = client.parseUsageInfo(receipt);

    expect(feeUsage.toNumber(), 'fee usage should be 21000').be.equal(21000);
    expect(balanceUsage.toNumber(), 'balance usage should be 0').be.equal(0);
  });

  it('should deposit succeed(3)', async () => {
    const genesis1 = accMngr.n2a('genesis1').toString();
    const accounts = [accMngr.n2a('test2').toString(), accMngr.n2a('test3').toString(), accMngr.n2a('test4').toString()];
    const value = 100;
    let nonce = await web3.eth.getTransactionCount(genesis1);
    const gas = await client.fee.methods.deposit(accounts[0]).estimateGas({
      from: genesis1,
      value
    });

    const originCrude = await Promise.all(accounts.map(async (testAccount) => new BN(await client.feeToken.methods.balanceOf(testAccount).call())));
    originCrude.forEach((crude) => expect(crude.toNumber(), 'crude should be 0').be.equal(0));

    await Promise.all(
      accounts.map((testAccount) =>
        client.fee.methods.deposit(testAccount).send({
          from: genesis1,
          value,
          gas,
          nonce: nonce++
        })
      )
    );

    const newCrude = await Promise.all(accounts.map(async (testAccount) => new BN(await client.feeToken.methods.balanceOf(testAccount).call())));
    newCrude.forEach((crude) => expect(crude.gtn(0), 'crude should be greater than 0').be.true);
  });
});
