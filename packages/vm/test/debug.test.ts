import { expect } from 'chai';
import { Address, toBuffer, BN, keccak256, intToHex, bufferToHex } from 'ethereumjs-util';
import { SecureTrie as Trie } from '@rei-network/trie';
import { AbiCoder } from '@ethersproject/abi';
import { StateManager, StakingAccount } from '@rei-network/core/dist/stateManager';
import { JSDebug } from '@rei-network/core/dist/tracer/debug/jsDebug';
import { tracers } from '@rei-network/core/dist/tracer/tracers';
import { toAsync } from '@rei-network/core/dist/tracer/toAsync';
import { Blockchain } from '@rei-network/blockchain';
import { Database } from '@rei-network/database';
import { Block, BlockHeader, Transaction } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { VM } from '../src';
import { IDebug } from '../src/types';
const level = require('level-mem');

const coder = new AbiCoder();
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const privateKey = toBuffer('0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0');
const sender = Address.fromPrivateKey(privateKey);

const database = new Database(level(), common);
const blockchain = new Blockchain({ database, common });
const stateManager = new StateManager({ common, trie: new Trie(database.rawdb) });
const vm = new VM({
  common,
  blockchain,
  stateManager,
  hardforkByBlockNumber: true,
  getMiner: (header: BlockHeader) => {
    return header.coinbase;
  }
});

async function runTx(tx: Transaction, root: Buffer, debug?: IDebug) {
  const block = Block.fromBlockData({ transactions: [tx] }, { common });
  const result = await vm.runBlock({ block, root, debug, generate: true, skipBlockValidation: true, runTxOpts: { skipNonce: true, skipBlockGasLimitValidation: true } });
  return result;
}

async function debugTx(tx: Transaction, root: Buffer) {
  let newRoot: Buffer | undefined;
  const result = await new Promise<any>(async (resolve, reject) => {
    try {
      const jsDebug = new JSDebug(common, { toAsync: true, tracer: toAsync(`const obj = ${tracers.get('replayTracer')}`) }, reject, tx.hash());
      const runResult = await runTx(tx, root, jsDebug);
      const error = runResult.results[0].execResult.exceptionError;
      if (!error) {
        newRoot = runResult.stateRoot;
      }
      const result = await jsDebug.result();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });

  return { result, root: newRoot };
}

function encodeCallData(name: string, types?: string[], values?: any[]) {
  const data = types && values ? toBuffer(coder.encode(types, values)) : Buffer.alloc(0);
  const selector = keccak256(Buffer.from(`${name}(${types ? types.join(',') : ''})`)).slice(0, 4);
  return Buffer.concat([selector, data]);
}

/*
// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

contract C1 {
    receive() external payable {}

    function transferTo(address payable target, uint256 amount) external {
        target.transfer(amount);
    }
}

contract C2 {
    C1 public obj1;
    C1 public obj2;

    constructor() public payable {
        obj1 = new C1();
        obj2 = new C1();
    }

    receive() external payable {}

    function transferTo(uint256 amount) external {
        address(obj1).transfer(amount);
        obj1.transferTo(address(obj2), amount);
        address payable thisAddr = address(uint160(address(this)));
        obj2.transferTo(thisAddr, amount);
    }
}
*/

describe('JSDebug', () => {
  let lastRoot!: Buffer;
  let c2Addr!: Address;
  let obj1Addr!: Address;
  let obj2Addr!: Address;

  before(async () => {
    await stateManager.putAccount(sender, new StakingAccount(undefined, new BN(100)));
    lastRoot = await stateManager.getStateRoot();
  });

  it('should deploy contract succeed', async () => {
    const tx = Transaction.fromTxData(
      {
        to: undefined,
        data: toBuffer(
          '0x60806040526040516100109061009b565b604051809103906000f08015801561002c573d6000803e3d6000fd5b50600080546001600160a01b0319166001600160a01b03929092169190911790556040516100599061009b565b604051809103906000f080158015610075573d6000803e3d6000fd5b50600180546001600160a01b0319166001600160a01b03929092169190911790556100a7565b60f0806102da83390190565b610224806100b66000396000f3fe6080604052600436106100385760003560e01c8063250dd47b14610044578063ba0f49b714610075578063c371249e146100a15761003f565b3661003f57005b600080fd5b34801561005057600080fd5b506100596100b6565b604080516001600160a01b039092168252519081900360200190f35b34801561008157600080fd5b5061009f6004803603602081101561009857600080fd5b50356100c5565b005b3480156100ad57600080fd5b506100596101df565b6000546001600160a01b031681565b600080546040516001600160a01b039091169183156108fc02918491818181858888f193505050501580156100fe573d6000803e3d6000fd5b5060008054600154604080516302ccb1b360e41b81526001600160a01b0392831660048201526024810186905290519190921692632ccb1b30926044808201939182900301818387803b15801561015457600080fd5b505af1158015610168573d6000803e3d6000fd5b5050600154604080516302ccb1b360e41b815230600482018190526024820187905291519194506001600160a01b039092169250632ccb1b309160448082019260009290919082900301818387803b1580156101c357600080fd5b505af11580156101d7573d6000803e3d6000fd5b505050505050565b6001546001600160a01b03168156fea26469706673582212204974d2e9cccd0ba87929e6f99cd2dc6bb720064d91ca8a3c6d13ff2ecd0b60c964736f6c63430006020033608060405234801561001057600080fd5b5060d18061001f6000396000f3fe608060405260043610601f5760003560e01c80632ccb1b3014602a576025565b36602557005b600080fd5b348015603557600080fd5b50605f60048036036040811015604a57600080fd5b506001600160a01b0381351690602001356061565b005b6040516001600160a01b0383169082156108fc029083906000818181858888f193505050501580156096573d6000803e3d6000fd5b50505056fea2646970667358221220d7b8d9f8256598bec339fbec0ae349caddb72ca0c6723857148c2efc2e0c5ec664736f6c63430006020033'
        ),
        gasLimit: new BN(80000000),
        gasPrice: new BN(0),
        value: new BN(100)
      },
      { common }
    ).sign(privateKey);

    // load contract addresses
    const result = await runTx(tx, lastRoot);
    lastRoot = result.stateRoot;
    c2Addr = result.results[0].createdAddress!;

    {
      const {
        execResult: { returnValue }
      } = await vm.runCall({ caller: sender, to: c2Addr, data: encodeCallData('obj1') });
      obj1Addr = new Address(returnValue.slice(12));
    }

    {
      const {
        execResult: { returnValue }
      } = await vm.runCall({ caller: sender, to: c2Addr, data: encodeCallData('obj2') });
      obj2Addr = new Address(returnValue.slice(12));
    }
  });

  it('should call contract succeed', async () => {
    const tx = Transaction.fromTxData(
      {
        to: c2Addr,
        data: encodeCallData('transferTo', ['uint256'], [1]),
        gasLimit: new BN(80000000),
        gasPrice: new BN(0),
        value: new BN(0)
      },
      { common }
    ).sign(privateKey);

    const { result, root } = await debugTx(tx, lastRoot);

    expect(root !== undefined, 'should call contract succeed').be.true;
    lastRoot = root!;

    /**
     * There are 6 calls here:
     * 1. sender call c2.transferTo(amount)
     * 2. c2 call obj1.transfer(amount)
     * 3. c2 call obj1.transferTo(obj2, amount)
     * 4. obj1 call obj2.transfer(amount)
     * 5. c2 call obj2.transferTo(c2, amount)
     * 6. obj2 call c2.transfer(amount)
     */
    expect(Array.isArray(result) && result.length === 6, 'debug result should be an array').be.true;

    const call0 = result[0].action;
    expect(call0.callType).be.equal('call');
    expect(call0.from).be.equal(sender.toString());
    expect(call0.to).be.equal(c2Addr.toString());
    expect(call0.input).be.equal(bufferToHex(encodeCallData('transferTo', ['uint256'], [1])));
    expect(call0.value).be.equal(intToHex(0));

    const call1 = result[1].action;
    expect(call1.callType).be.equal('call');
    expect(call1.from).be.equal(c2Addr.toString());
    expect(call1.to).be.equal(obj1Addr.toString());
    expect(call1.input).be.equal('0x');
    expect(call1.value).be.equal(intToHex(1));

    const call2 = result[2].action;
    expect(call2.callType).be.equal('call');
    expect(call2.from).be.equal(c2Addr.toString());
    expect(call2.to).be.equal(obj1Addr.toString());
    expect(call2.input).be.equal(bufferToHex(encodeCallData('transferTo', ['address', 'uint256'], [obj2Addr.toString(), 1])));
    expect(call2.value).be.equal(intToHex(0));

    const call3 = result[3].action;
    expect(call3.callType).be.equal('call');
    expect(call3.from).be.equal(obj1Addr.toString());
    expect(call3.to).be.equal(obj2Addr.toString());
    expect(call3.input).be.equal('0x');
    expect(call3.value).be.equal(intToHex(1));

    const call4 = result[4].action;
    expect(call4.callType).be.equal('call');
    expect(call4.from).be.equal(c2Addr.toString());
    expect(call4.to).be.equal(obj2Addr.toString());
    expect(call4.input).be.equal(bufferToHex(encodeCallData('transferTo', ['address', 'uint256'], [c2Addr.toString(), 1])));
    expect(call4.value).be.equal(intToHex(0));

    const call5 = result[5].action;
    expect(call5.callType).be.equal('call');
    expect(call5.from).be.equal(obj2Addr.toString());
    expect(call5.to).be.equal(c2Addr.toString());
    expect(call5.input).be.equal('0x');
    expect(call5.value).be.equal(intToHex(1));
  });

  it('should call contract failed(outOfGasLimit)', async () => {
    const tx = Transaction.fromTxData(
      {
        to: c2Addr,
        data: encodeCallData('transferTo', ['uint256'], [0]),
        gasLimit: new BN(22000),
        gasPrice: new BN(0),
        value: new BN(0)
      },
      { common }
    ).sign(privateKey);

    const { result, root } = await debugTx(tx, lastRoot);
    expect(root === undefined, 'should call contract failed').be.true;

    expect(Array.isArray(result) && result.length === 1, 'debug result should be an array').be.true;
    expect(result[0].error, 'should be out of gas').be.equal('out of gas');
  });
});
