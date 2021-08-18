import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, BN, MAX_INTEGER, setLengthLeft, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { Log, Receipt } from '@gxchain2/structure';
import { hexStringToBuffer } from '@gxchain2/utils';
import { ValidatorChanges } from '../staking';
import { bufferToAddress } from './utils';

// function selector of stake manager
const methods = {
  indexedValidatorsLength: toBuffer('0x74a1c64a'),
  indexedValidatorsByIndex: toBuffer('0xaf6a80e2'),
  validators: toBuffer('0xfa52c7d8'),
  getVotingPowerByIndex: toBuffer('0x9b8c4c88'),
  reward: toBuffer('0x6353586b')
};

// event topic
const events = {
  Stake: toBuffer('0x1bd1eb6b4fd3f08e718d7a241c54c4641c9f36004b6949383f48d15a2fcc8f52'),
  StartUnstake: toBuffer('0x020b3ba91672f551cfd1f7abf4794b3fb292f61fd70ffd5a34a60cdd04078e50'),
  SetCommissionRate: toBuffer('0xaa2933ee3941c066bda0e3f51e3e6ce63f33379daee1ef99baf018764d321e54'),
  IndexedValidator: toBuffer('0x07c18d1e961213770ba59e4b4001fc312f17def9ba35867316edefe029c5dd18'),
  UnindexedValidator: toBuffer('0xa37745de139b774fe502f6f6da1c791e290244eb016b146816e3bcd8b13bc999')
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
      console.log('log:', log.toRPCJSON());
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
      data: Buffer.concat([methods[method], ...data])
    });
  }

  async deploy() {
    const smaddr = Address.fromString(this.common.param('vm', 'smaddr'));
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: smaddr,
        to: smaddr,
        gasLimit: MAX_INTEGER,
        // stakeManger code + configAddress + 000...40(rlp list) + 000...03(list length) + genesisValidator1 + genesisValidator2 + ...
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'smcode')), setLengthLeft(hexStringToBuffer(this.common.param('vm', 'cfgaddr')), 32), setLengthLeft(Buffer.from('40', 'hex'), 32), setLengthLeft(Buffer.from('03', 'hex'), 32), ...(this.common.param('vm', 'genesisValidators') as string[]).map((addr) => setLengthLeft(hexStringToBuffer(addr), 32))])
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
    } = await this.evm.executeMessage(this.makeMessage('indexedValidatorsByIndex', [setLengthLeft(index.toBuffer(), 32)]));
    return bufferToAddress(returnValue);
  }

  async validators(validator: Address): Promise<Validator> {
    const {
      execResult: { returnValue }
    } = await this.evm.executeMessage(this.makeMessage('validators', [setLengthLeft(validator.buf, 32)]));
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
    } = await this.evm.executeMessage(this.makeMessage('getVotingPowerByIndex', [setLengthLeft(index.toBuffer(), 32)]));
    return new BN(returnValue);
  }

  async reward(validator: Address, amount: BN) {
    const message = new Message({
      caller: Address.fromString(this.common.param('vm', 'scaddr')),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      value: amount,
      data: Buffer.concat([methods['reward'], setLengthLeft(validator.toBuffer(), 32)])
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
