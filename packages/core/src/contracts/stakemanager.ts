import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, BN, MAX_INTEGER, setLengthLeft, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { Log, Receipt } from '@gxchain2/structure';
import { hexStringToBuffer } from '@gxchain2/utils';
import { ValidatorChanges } from '../staking';
import { bufferToAddress, toContractCallData, bnToInt256Buffer, int256BufferToBN } from './utils';

// function selector of stake manager
const methods = {
  indexedValidatorsLength: toBuffer('0x74a1c64a'),
  indexedValidatorsByIndex: toBuffer('0xaf6a80e2'),
  validators: toBuffer('0xfa52c7d8'),
  getVotingPowerByIndex: toBuffer('0x9b8c4c88'),
  afterBlock: toBuffer('0xf3d62333'),
  activeValidatorsLength: toBuffer('0x75bac430'),
  activeValidators: toBuffer('0x14f64c78')
};

// event topic
const events = {
  Stake: toBuffer('0x1bd1eb6b4fd3f08e718d7a241c54c4641c9f36004b6949383f48d15a2fcc8f52'),
  StartUnstake: toBuffer('0x020b3ba91672f551cfd1f7abf4794b3fb292f61fd70ffd5a34a60cdd04078e50'),
  SetCommissionRate: toBuffer('0xaa2933ee3941c066bda0e3f51e3e6ce63f33379daee1ef99baf018764d321e54'),
  IndexedValidator: toBuffer('0x07c18d1e961213770ba59e4b4001fc312f17def9ba35867316edefe029c5dd18'),
  UnindexedValidator: toBuffer('0xa37745de139b774fe502f6f6da1c791e290244eb016b146816e3bcd8b13bc999')
};

export type ActiveValidator = {
  validator: Address;
  priority: BN;
};

export type Validator = {
  id: BN;
  validatorKeeper: Address;
  commissionShare: Address;
  unstakeKeeper: Address;
  commissionRate: BN;
  updateTimestamp: BN;
};

export class StakeManager {
  evm!: EVM;
  common!: Common;

  constructor(evm: EVM, common: Common) {
    this.evm = evm;
    this.common = common;
  }

  static filterReceiptsChanges(changes: ValidatorChanges, receipts: Receipt[], common: Common) {
    for (const receipt of receipts) {
      if (receipt.logs.length > 0) {
        StakeManager.filterLogsChanges(changes, receipt.logs, common);
      }
    }
  }

  static filterLogsChanges(changes: ValidatorChanges, logs: Log[], common: Common) {
    const smaddr = Address.fromString(common.param('vm', 'smaddr'));
    for (const log of logs) {
      if (log.address.equals(smaddr.buf)) {
        if (log.topics.length === 3 && log.topics[0].equals(events['Stake'])) {
          // Stake event
          changes.stake(bufferToAddress(log.topics[1]), new BN(log.topics[2]));
        } else if (log.topics.length === 4 && log.topics[0].equals(events['StartUnstake'])) {
          // StartUnstake event
          changes.unstake(bufferToAddress(log.topics[2]), new BN(log.topics[3]));
        } else if (log.topics.length === 4 && log.topics[0].equals(events['SetCommissionRate'])) {
          // SetCommissionRate event
          changes.setCommissionRate(bufferToAddress(log.topics[1]), new BN(log.topics[2]), new BN(log.topics[3]));
        } else if (log.topics.length === 3 && log.topics[0].equals(events['IndexedValidator'])) {
          // IndexedValidator event
          changes.index(bufferToAddress(log.topics[1]), new BN(log.topics[2]));
        } else if (log.topics.length === 2 && log.topics[0].equals(events['UnindexedValidator'])) {
          // UnindexedValidator event
          changes.unindex(bufferToAddress(log.topics[1]));
        }
      }
    }
  }

  private makeMessage(method: string, data: Buffer[]) {
    return new Message({
      caller: Address.zero(),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      data: Buffer.concat([methods[method], ...toContractCallData(data)])
    });
  }

  async deploy() {
    const smaddr = Address.fromString(this.common.param('vm', 'smaddr'));
    const genesisValidator: string[] = this.common.param('vm', 'genesisValidators');
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: smaddr,
        to: smaddr,
        gasLimit: MAX_INTEGER,
        // stakeManger code + configAddress + 000...40(rlp list) + genesisValidators.length(list length) + genesisValidator1 + genesisValidator2 + ...
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'smcode')), ...toContractCallData([hexStringToBuffer(this.common.param('vm', 'cfgaddr')), Buffer.from('40', 'hex'), toBuffer(genesisValidator.length), ...genesisValidator.map((addr) => hexStringToBuffer(addr))])])
      })
    );
    if (result.execResult.exceptionError) {
      throw result.execResult.exceptionError;
    }
  }

  async indexedValidatorsLength() {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('indexedValidatorsLength', []));
    return new BN(returnValue);
  }

  async indexedValidatorsByIndex(index: BN) {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('indexedValidatorsByIndex', [index.toBuffer()]));
    return bufferToAddress(returnValue);
  }

  async validators(validator: Address): Promise<Validator> {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('validators', [validator.buf]));
    if (returnValue.length !== 6 * 32) {
      throw new Error('invalid return value length');
    }
    let i = 0;
    return {
      id: new BN(returnValue.slice(i++ * 32, i * 32)),
      validatorKeeper: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
      commissionShare: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
      unstakeKeeper: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
      commissionRate: new BN(returnValue.slice(i++ * 32, i * 32)),
      updateTimestamp: new BN(returnValue.slice(i++ * 32, i * 32))
    };
  }

  async getVotingPowerByIndex(index: BN) {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('getVotingPowerByIndex', [index.toBuffer()]));
    return new BN(returnValue);
  }

  async activeValidatorsLength() {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('activeValidatorsLength', []));
    return new BN(returnValue);
  }

  async activeValidators(index: BN): Promise<ActiveValidator> {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('activeValidators', [index.toBuffer()]));
    if (returnValue.length !== 2 * 32) {
      throw new Error('invalid return value length');
    }
    let i = 0;
    return {
      validator: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
      priority: int256BufferToBN(returnValue.slice(i++ * 32, i * 32))
    };
  }

  async afterBlock(validator: Address, activeValidators: Address[], priorities: BN[], amount: BN) {
    const message = new Message({
      caller: Address.fromString(this.common.param('vm', 'scaddr')),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      value: amount,
      // method + validator address + 60 + c0 + activeValidators.length + activeValidators... + priorities.length + priorities...
      data: Buffer.concat([methods['afterBlock'], ...toContractCallData([validator.toBuffer(), Buffer.from('60', 'hex'), Buffer.from('c0', 'hex'), toBuffer(activeValidators.length), ...activeValidators.map((addr) => addr.buf), toBuffer(priorities.length), ...priorities.map((p) => bnToInt256Buffer(p))])])
    });
    const {
      execResult: { logs, exceptionError }
    } = await this.evm.executeMessage(message);
    if (exceptionError) {
      throw exceptionError;
    }
    return logs;
  }
}
