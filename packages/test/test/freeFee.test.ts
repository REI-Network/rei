import crypto from 'crypto';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { expect, assert } from 'chai';
import { MockAccountManager } from '../../core/test/util';
import { Client } from '../src';

const accMngr = new MockAccountManager([
  ['genesis1', Address.fromString('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'), Buffer.from('225a70405aa06a0dc0451fb51a9284a0dab949257f8a2df90192b5238e76936a', 'hex')],
  ['admin', Address.fromString('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'), Buffer.from('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'hex')]
]);

const client = new Client('ws://127.0.0.1:11451', '0x0000000000000000000000000000000000001000');

let userFreeFeeLimit!: BN;
let freeFeeRecoverInterval!: number;

const sendTestTransaction = (gasPrice: BN) => {
  return client.web3.eth.sendTransaction({
    from: accMngr.n2a('test1').toString(),
    to: accMngr.n2a('genesis1').toString(),
    value: 0,
    gas: 21000,
    gasPrice: gasPrice.toString()
  });
};

describe('Free fee', () => {
  before(async () => {
    await client.init();

    // create a random account
    const priv = crypto.randomBytes(32);
    const addr = Address.fromPrivateKey(priv);
    accMngr.add([['test1', addr, priv]]);

    // unlock all accounts
    for (const [name, addr] of accMngr.nameToAddress) {
      client.web3.eth.accounts.wallet.add({
        address: addr.toString(),
        privateKey: bufferToHex(accMngr.n2p(name))
      });
    }

    // transfer amount to the test1 account
    const amount = '1' + '0'.repeat(18); // 1 GXC
    await client.web3.eth.sendTransaction({
      from: accMngr.n2a('genesis1').toString(),
      to: accMngr.n2a('test1').toString(),
      value: amount,
      gas: 21000
    });

    // ensure user balance
    expect(await client.web3.eth.getBalance(accMngr.n2a('test1').toString())).be.equal(amount);

    // load config
    userFreeFeeLimit = new BN(await client.config.methods.userFreeFeeLimit().call());
    freeFeeRecoverInterval = Number(await client.config.methods.freeFeeRecoverInterval().call());
    if (!Number.isInteger(freeFeeRecoverInterval)) {
      assert.fail('invalid freeFeeRecoverInterval');
    }

    // update free fee recover interval to 1 day
    await client.config.methods.setFreeFeeRecoverInterval(86400).send({ from: accMngr.n2a('admin').toString(), gas: 100000, gasPrice: 1 });
  });

  it('should transfer successfully(1)', async () => {
    expect((await client.freeFee.methods.userUsage(accMngr.n2a('test1').toString()).call()).usage).be.equal('0');

    const gasPrice = new BN(10);
    const { logs } = await sendTestTransaction(gasPrice);

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
    const { logs } = await sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);

    expect(feeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.eq(freeFeeUsed)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eq(balanceUsed)).be.true;
  });

  it('should transfer successfully(3)', async () => {
    const gasPrice = new BN(1);
    const { logs } = await sendTestTransaction(gasPrice);

    expect(logs.length > 0).be.true;
    const { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage } = client.parseUsageInfoLog(logs[logs.length - 1]);

    expect(feeUsage.eqn(0)).be.true;
    expect(freeFeeUsage.eqn(0)).be.true;
    expect(contractFeeUsage.eqn(0)).be.true;
    expect(balanceUsage.eq(gasPrice.muln(21000))).be.true;
  });
});
