import fs from 'fs';
import path from 'path';
import { Common } from '../../../common/src';
import { expect } from 'chai';
import { bufferToHex, BN } from 'ethereumjs-util';
import { Block, calcTxSize, mustParseTransction, WrappedTransaction, calcTransactionTrie, Transaction, calcIntrinsicGasByTx } from '../../src';

describe('Transaction', () => {
  let testblock: Block;
  let testTransaction: Transaction;
  let testTransaction2: Transaction;
  let wrappedTestTrx: WrappedTransaction;
  let testdata: any;

  before(() => {
    const common = Common.createChainStartCommon('gxc2-testnet');
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, './test-data.json')).toString());
    testblock = Block.fromBlockData(testdata, { common, hardforkByBlockNumber: true });
    testTransaction = Transaction.fromTxData(testdata.transactions[0]);
    testTransaction2 = Transaction.fromTxData(testdata.transactions[1]);
    wrappedTestTrx = new WrappedTransaction(testTransaction);
    wrappedTestTrx.installProperties(testblock, 0);
  });

  it('should get size', () => {
    const trxsize = wrappedTestTrx.size;
    expect(trxsize, 'transaction size should be equal').be.equal(calcTxSize(testTransaction));
  });

  it('should calculate TransactionTrie correctly', async () => {
    const transactionTrie = await calcTransactionTrie([testTransaction, testTransaction2]);
    expect(bufferToHex(transactionTrie), 'transactionTrie should be equal').be.equal(testdata.header.transactionsTrie);
  });

  it('should calculate IntrinsicGas correctly', () => {
    const gas = calcIntrinsicGasByTx(testTransaction);
    expect(gas.eq(new BN(testdata.testTransaction.intrinsicgas)), 'gas should be equal').be.true;
  });

  it('should parse transction', () => {
    const txValuesArray = testTransaction.raw();
    const testTransaction3 = mustParseTransction(txValuesArray);
    expect(testTransaction.hash().equals(testTransaction3.hash()), 'transaction should be equal').be.true;
  });

  it('should convert to rpcjson', () => {
    const rpcjson = wrappedTestTrx.toRPCJSON();
    expect(rpcjson.blockHash, 'blockHash should be equal').equal(testdata.transactions[0].blockHash);
    expect(rpcjson.blockNumber, 'blockNumber should be equal').equal(testdata.transactions[0].blockNumber);
    expect(rpcjson.from, 'from should be equal').equal(testdata.transactions[0].from);
    expect(rpcjson.gas, 'gas should be equal').equal(testdata.transactions[0].gasLimit);
    expect(rpcjson.gasPrice, 'gasPrice should be equal').equal(testdata.transactions[0].gasPrice);
    expect(rpcjson.hash, 'hash should be equal').equal(testdata.transactions[0].hash);
    expect(rpcjson.input, 'data should be equal').equal(testdata.transactions[0].data);
    expect(rpcjson.nonce, 'nonce should be equal').equal(testdata.transactions[0].nonce);
    expect(rpcjson.to, 'to should be equal').equal(testdata.transactions[0].to);
    expect(rpcjson.transactionIndex, 'transactionIndex should be equal').equal(testdata.transactions[0].transactionIndex);
    expect(rpcjson.value, 'value should be equal').equal(testdata.transactions[0].value);
    expect(rpcjson.v, 'v should be equal').equal(testdata.transactions[0].v);
    expect(rpcjson.r, 'r should be equal').equal(testdata.transactions[0].r);
    expect(rpcjson.s, 's should be equal').equal(testdata.transactions[0].s);
  });
});
