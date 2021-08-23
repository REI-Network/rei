import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, BN, MAX_INTEGER, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { Log, Receipt } from '@gxchain2/structure';
import { hexStringToBuffer } from '@gxchain2/utils';
import { ValidatorChanges } from '../staking';
import { bufferToAddress, encode, decodeInt256 } from './utils';

// function selector of stake manager
const methods = {
  indexedValidatorsLength: toBuffer('0x74a1c64a'),
  indexedValidatorsByIndex: toBuffer('0xaf6a80e2'),
  validators: toBuffer('0xfa52c7d8'),
  getVotingPowerByIndex: toBuffer('0x9b8c4c88'),
  reward: toBuffer('0x6353586b'),
  afterBlock: toBuffer('0xa51f8223'),
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

// active validator information
export type ActiveValidator = {
  // validator address
  validator: Address;
  // proposer priority
  priority: BN;
};

// validator information
export type Validator = {
  // unique validator id
  id: BN;
  // validator keeper contract address
  // it holds block reward for validator
  validatorKeeper: Address;
  // validator commission share contract address
  // it holds block reward for commission
  commissionShare: Address;
  // validator unstake keeper contract address
  // it holds unstake amount for no timeout unstake
  unstakeKeeper: Address;
  // commission rate set by validator
  // CommissionReward = BlockReward * commissionRate / 100
  // ValidatorReward = BlockReward - CommissionReward
  commissionRate: BN;
  // latest `commissionRate` update timestamp
  updateTimestamp: BN;
};

// a class used to interact with the stake manager contract
export class StakeManager {
  evm!: EVM;
  common!: Common;

  constructor(evm: EVM, common: Common) {
    this.evm = evm;
    this.common = common;
  }

  /**
   * Filter validator set changes from receipts
   * @param changes - `ValidatorChanges` instance
   * @param receipts - List of receipt
   * @param common - Common instance
   */
  static filterReceiptsChanges(changes: ValidatorChanges, receipts: Receipt[], common: Common) {
    for (const receipt of receipts) {
      if (receipt.logs.length > 0) {
        StakeManager.filterLogsChanges(changes, receipt.logs, common);
      }
    }
  }

  /**
   * Filter validator set changes from logs
   * @param changes - `ValidatorChanges` instance
   * @param logs - List of log
   * @param common - Common instance
   */
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

  // make a call message
  private makeMessage(method: string, types: string[], values: any[]) {
    return new Message({
      caller: Address.zero(),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      data: Buffer.concat([methods[method], encode(types, values)])
    });
  }

  // make a system call message
  private makeSystemCallerMessage(method: string, types: string[], values: any[], amount?: BN) {
    return new Message({
      caller: Address.fromString(this.common.param('vm', 'scaddr')),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      value: amount,
      data: Buffer.concat([methods[method], encode(types, values)])
    });
  }

  // execute a message, throw a error if `exceptionError` is not undefined
  private async executeMessage(message: Message) {
    const {
      execResult: { logs, returnValue, exceptionError }
    } = await this.evm.executeMessage(message);
    if (exceptionError) {
      throw exceptionError;
    }
    return { logs, returnValue };
  }

  /**
   * Deploy stake manager contract to `common.param('vm', 'smaddr')`
   */
  async deploy() {
    const smaddr = Address.fromString(this.common.param('vm', 'smaddr'));
    const genesisValidator: string[] = this.common.param('vm', 'genesisValidators');
    await this.executeMessage(
      new Message({
        contractAddress: smaddr,
        to: smaddr,
        gasLimit: MAX_INTEGER,
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'smcode')), encode(['address', 'address[]'], [this.common.param('vm', 'cfgaddr'), genesisValidator])])
      })
    );
  }

  /**
   * Get indexed validator set length
   * @returns Length
   */
  async indexedValidatorsLength() {
    const { returnValue } = await this.executeMessage(this.makeMessage('indexedValidatorsLength', [], []));
    return new BN(returnValue);
  }

  /**
   * Get indexed validator address by index
   * @param index - Validator index
   * @returns Validator address
   */
  async indexedValidatorsByIndex(index: BN) {
    const { returnValue } = await this.executeMessage(this.makeMessage('indexedValidatorsByIndex', ['uint256'], [index.toString()]));
    return bufferToAddress(returnValue);
  }

  /**
   * Get validator information by validator address
   * @param validator - Validator address
   * @returns Validator information
   */
  async validators(validator: Address): Promise<Validator> {
    const { returnValue } = await this.executeMessage(this.makeMessage('validators', ['address'], [validator.toString()]));
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

  /**
   * Get validator voting power by index
   * @param index - Validator index
   * @returns Voting power
   */
  async getVotingPowerByIndex(index: BN) {
    const { returnValue } = await this.executeMessage(this.makeMessage('getVotingPowerByIndex', ['uint256'], [index.toString()]));
    return new BN(returnValue);
  }

  /**
   * Get active validator set length
   * @returns Length
   */
  async activeValidatorsLength() {
    const { returnValue } = await this.executeMessage(this.makeMessage('activeValidatorsLength', [], []));
    return new BN(returnValue);
  }

  /**
   * Get active validator information by index
   * @param index - Validator index
   * @returns Active validator information
   */
  async activeValidators(index: BN): Promise<ActiveValidator> {
    const { returnValue } = await this.executeMessage(this.makeMessage('activeValidators', ['uint256'], [index.toString()]));
    if (returnValue.length !== 2 * 32) {
      throw new Error('invalid return value length');
    }
    let i = 0;
    return {
      validator: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
      priority: decodeInt256(returnValue.slice(i++ * 32, i * 32))
    };
  }

  /**
   * Reward validator
   * @param validator - Validator address
   * @param amount - Reward amount
   * @returns Logs emited by contract
   */
  async reward(validator: Address, amount: BN) {
    const { logs } = await this.executeMessage(this.makeSystemCallerMessage('reward', ['address'], [validator.toString()], amount));
    return logs;
  }

  /**
   * Call `afterBlock` callback
   * @param activeValidators - Set of sorted active validators for the next block
   * @param priorities - Set of sorted active validators' proposer priority
   */
  async afterBlock(activeValidators: Address[], priorities: BN[]) {
    await this.executeMessage(this.makeSystemCallerMessage('afterBlock', ['address[]', 'int256[]'], [activeValidators.map((addr) => addr.toString()), priorities.map((p) => p.toString())]));
  }
}
