import { expect } from 'chai';
import { Address, BN, keccak256 } from 'ethereumjs-util';
import { Block, Transaction } from '@gxchain2/structure';
import { setLevel } from '@gxchain2/utils';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { Node } from '../../src';
import { createNode, destroyNode, loadBlocksFromTestData } from '../util';
import { Config } from '../config';

setLevel('silent');
const dirname = 'vm';
const address1 = Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593');
const address2 = Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b');

function createConfig(vm: VM, block: Block) {
  const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), block);
  return new Config(evm, block._common);
}

async function makeContracts(node: Node, block: Block) {
  const vm = await node.getVM(block.header.stateRoot, block._common);
  const router = node.getRouter(vm, block);
  return { router };
}

describe('VM', () => {
  let node: Node;
  let blocks: Block[];
  let dailyFee!: BN;
  let dailyFreeFee!: BN;
  let userFreeFeeLimit!: BN;

  async function checkTransaction(tx: Transaction) {
    const receipt = await node.db.getReceipt(tx.hash());
    expect(receipt.logs.length > 0, 'logs length should be greater than 0').be.true;
    const log = receipt.logs[receipt.logs.length - 1];
    // log address should be router
    expect(log.address.toString('hex'), 'log address should be equal').be.equal('0000000000000000000000000000000000001008');
    expect(log.topics[0].toString('hex'), 'topics should be equal').be.equal(keccak256(Buffer.from('UsageInfo(uint256,uint256,uint256,uint256)')).toString('hex'));
    expect(log.data.length, 'log data should be 32 * 4').be.equal(32 * 4);
    let i = 0;
    const feeUsage = new BN(log.data.slice(i++ * 32, i * 32));
    const freeFeeUsage = new BN(log.data.slice(i++ * 32, i * 32));
    const contractFeeUsage = new BN(log.data.slice(i++ * 32, i * 32));
    const balUsage = new BN(log.data.slice(i++ * 32, i * 32));
    expect(feeUsage.add(freeFeeUsage).add(contractFeeUsage).add(balUsage).toString(), 'usage should be equal').be.equal(new BN(receipt.cumulativeGasUsed).mul(tx.gasPrice).toString());
    return receipt;
  }

  before(async () => {
    node = await createNode(dirname, 'gxc2-testnet');
    blocks = loadBlocksFromTestData(dirname, 'blocks', 'gxc2-testnet');
  });

  it('should process first 10 blocks succeed', async () => {
    for (let i = 0; i < 10; i++) {
      await node.processBlock(blocks[i], { broadcast: false });
    }
    // the first 10 blocks are irrelevant...
    blocks = blocks.slice(10);

    // init global config value
    const block = node.blockchain.latestBlock;
    const vm = await node.getVM(block.header.stateRoot, block._common);
    const config = createConfig(vm, block);
    dailyFee = await config.dailyFee();
    dailyFreeFee = await config.dailyFreeFee();
    userFreeFeeLimit = await config.userFreeFeeLimit();
  });

  it('should deposit for address2 succeed', async () => {
    // this block contains a transaction:
    // address1 deposit for address2 400 wei
    const block = blocks.shift()!;
    await node.processBlock(block, { broadcast: false });
    await checkTransaction(block.transactions[0] as Transaction);
    const { router } = await makeContracts(node, block);
    const { fee, freeFee, contractFee } = await router.estimateTotalFee(address2, Address.zero(), block.header.timestamp.toNumber());
    // now there is only address2 is deposited, so his fee should be equal to `dailyFee`
    expect(fee.toString(), 'fee should be equal').be.equal(dailyFee.toString());
    // now address2 has not initiated any transaction, so his free fee should be equal to `userFreeFeeLimit`
    expect(freeFee.toString(), 'free fee should be equal').be.equal(userFreeFeeLimit.toString());
    // there is no contract fee yet...
    expect(contractFee.toString(), 'contract fee should be zero').be.equal('0');
  });

  it('should deposit for address1 succeed', async () => {
    // this block contains a transaction:
    // address1 deposit for address1 100 wei
    const block = blocks.shift()!;
    await node.processBlock(block, { broadcast: false });
    await checkTransaction(block.transactions[0] as Transaction);
    const { router } = await makeContracts(node, block);
    {
      const { fee } = await router.estimateTotalFee(address1, Address.zero(), block.header.timestamp.toNumber());
      // now address1 has depoisted 100 wei, and address2 has depoisted 400 wei
      expect(fee.toString(), 'fee should be equal').be.equal(dailyFee.muln(100).divn(500).toString());
    }
    {
      const { fee } = await router.estimateTotalFee(address2, Address.zero(), block.header.timestamp.toNumber());
      expect(fee.toString(), 'fee should be equal').be.equal(dailyFee.muln(400).divn(500).toString());
    }
  });

  it('should transfer succeed', async () => {
    // this block contains a transaction:
    // address1 transfer 1 GXC to address2
    const block = blocks.shift()!;
    await node.processBlock(block, { broadcast: false });
    const receipt = await checkTransaction(block.transactions[0] as Transaction);
    expect(new BN(receipt.cumulativeGasUsed).toString(), 'gas used should be 21000').be.equal('21000');
  });

  it('should deploy succeed', async () => {
    // this block contains a transaction:
    // address2 deploy a contract
    const block = blocks.shift()!;
    await node.processBlock(block, { broadcast: false });
    const receipt = await checkTransaction(block.transactions[0] as Transaction);
    expect(receipt.contractAddress !== undefined, 'contract address should exist').be.true;
  });

  after(async () => {
    await destroyNode(dirname, node);
  });
});
