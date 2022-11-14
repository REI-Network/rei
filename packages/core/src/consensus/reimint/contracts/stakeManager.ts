import EVM from '@rei-network/vm/dist/evm/evm';
import { Address, BN, toBuffer, rlp } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Log, Receipt } from '@rei-network/structure';
import { ValidatorChanges, getGenesisValidators } from '../validatorSet';
import { validatorsEncode, validatorsDecode } from '../../../utils';
import { bufferToAddress, decodeInt256, decodeBytes } from './utils';
import { Contract } from './contract';
import { isEnableValidatorIds } from '../../../hardforks';

// function selector of stake manager
const methods = {
  getTotalLockedAmountAndValidatorCount: toBuffer('0xcf6f5534'),
  indexedValidatorsLength: toBuffer('0x74a1c64a'),
  indexedValidatorsByIndex: toBuffer('0xaf6a80e2'),
  getVotingPowerByIndex: toBuffer('0x9b8c4c88'),
  getVotingPowerByAddress: toBuffer('0x7fdde75c'),
  activeValidatorsLength: toBuffer('0x75bac430'),
  activeValidators: toBuffer('0x14f64c78'),
  proposer: toBuffer('0xa8e4fb90'),
  reward: toBuffer('0x6353586b'),
  slash: toBuffer('0x30b409a4'),
  onAfterBlock: toBuffer('0x9313f105'),
  indexedValidatorsById: toBuffer('0x36137fae'),
  onAfterBlockValidatorIds: toBuffer('0x14215c9a'),
  getActiveValidatorIds: toBuffer('0x86096972'),
  validators: toBuffer('0xfa52c7d8')
};

// event topic
const events = {
  Reward: toBuffer('0x619caafabdd75649b302ba8419e48cccf64f37f1983ac4727cfb38b57703ffc9'),
  Slash: toBuffer('0xa69f22d963cb7981f842db8c1aafcc93d915ba2a95dcf26dcc333a9c2a09be26'),
  Stake: toBuffer('0x1bd1eb6b4fd3f08e718d7a241c54c4641c9f36004b6949383f48d15a2fcc8f52'),
  StartUnstake: toBuffer('0x020b3ba91672f551cfd1f7abf4794b3fb292f61fd70ffd5a34a60cdd04078e50'),
  IndexedValidator: toBuffer('0x07c18d1e961213770ba59e4b4001fc312f17def9ba35867316edefe029c5dd18'),
  UnindexedValidator: toBuffer('0xa37745de139b774fe502f6f6da1c791e290244eb016b146816e3bcd8b13bc999')
};

export enum SlashReason {
  DuplicateVote = 0
}

// active validator information
export type ActiveValidator = {
  // validator address
  validator: Address;
  // proposer priority
  priority: BN;
};

// a class used to interact with the stake manager contract
export class StakeManager extends Contract {
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
        if (log.topics.length === 3 && log.topics[0].equals(events['Reward'])) {
          // Reward event
          changes.stake(bufferToAddress(log.topics[1]), new BN(log.topics[2]));
        } else if (log.topics.length === 3 && log.topics[0].equals(events['Slash'])) {
          // Slash event
          changes.unstake(bufferToAddress(log.topics[1]), new BN(log.topics[2]));
        } else if (log.topics.length === 3 && log.topics[0].equals(events['Stake'])) {
          // Stake event
          changes.stake(bufferToAddress(log.topics[1]), new BN(log.topics[2]));
        } else if (log.topics.length === 4 && log.topics[0].equals(events['StartUnstake'])) {
          // StartUnstake event
          changes.unstake(bufferToAddress(log.topics[2]), new BN(log.topics[3]));
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

  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'smaddr')));
  }

  /**
   * Get proposer address
   * @returns Proposer address
   */
  proposer() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('proposer', [], []));
      return bufferToAddress(returnValue);
    });
  }

  /**
   * Get the total locked amount and the validator count
   * @returns Total locked amount and validator count
   */
  getTotalLockedAmountAndValidatorCount() {
    return this.runWithLogger(async () => {
      const gvs = getGenesisValidators(this.common);
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getTotalLockedAmountAndValidatorCount', ['address[]'], [gvs.map((gv) => gv.toString())]));
      let i = 0;
      return {
        totalLockedAmount: new BN(returnValue.slice(i++ * 32, i * 32)),
        validatorCount: new BN(returnValue.slice(i++ * 32, i * 32))
      };
    });
  }

  /**
   * Get indexed validator set length
   * @returns Length
   */
  indexedValidatorsLength() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('indexedValidatorsLength', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get indexed validator address by index
   * @param index - Validator index
   * @returns Validator address
   */
  indexedValidatorsByIndex(index: BN) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('indexedValidatorsByIndex', ['uint256'], [index.toString()]));
      return bufferToAddress(returnValue);
    });
  }

  /**
   * Get validator voting power by index
   * @param index - Validator index
   * @returns Voting power
   */
  getVotingPowerByIndex(index: BN) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getVotingPowerByIndex', ['uint256'], [index.toString()]));
      return new BN(returnValue);
    });
  }

  /**
   * Get validator voting power by address
   * @param address - Address
   * @returns Voting power
   */
  getVotingPowerByAddress(address: Address) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getVotingPowerByAddress', ['address'], [address.toString()]));
      return new BN(returnValue);
    });
  }

  /**
   * Get active validator set length
   * @returns Length
   */
  activeValidatorsLength() {
    return this.runWithLogger(async () => {
      if (isEnableValidatorIds(this.common)) {
        const { returnValue } = await this.executeMessage(this.makeCallMessage('getActiveValidatorIds', [], []));
        const data = decodeBytes(returnValue) as string;
        const { ids } = validatorsDecode(Buffer.from(data.slice(2), 'hex'));
        return new BN(ids.length);
      } else {
        const { returnValue } = await this.executeMessage(this.makeCallMessage('activeValidatorsLength', [], []));
        return new BN(returnValue);
      }
    });
  }

  /**
   * Get active validator information by index
   * @param index - Validator index
   * @returns Active validator information
   */
  activeValidators(index: BN): Promise<ActiveValidator> {
    return this.runWithLogger(async () => {
      if (isEnableValidatorIds(this.common)) {
        const { returnValue } = await this.executeMessage(this.makeCallMessage('getActiveValidatorIds', [], []));
        const data = decodeBytes(returnValue) as string;
        const { ids, priorities } = validatorsDecode(Buffer.from(data.slice(2), 'hex'));
        const { returnValue: rv } = await this.executeMessage(this.makeCallMessage('indexedValidatorsById', ['uint256'], [ids[index.toNumber()]]));
        return {
          validator: bufferToAddress(rv),
          priority: priorities[index.toNumber()]
        };
      } else {
        const { returnValue } = await this.executeMessage(this.makeCallMessage('activeValidators', ['uint256'], [index.toString()]));
        if (returnValue.length !== 2 * 32) {
          throw new Error('invalid return value length');
        }
        let i = 0;
        return {
          validator: bufferToAddress(returnValue.slice(i++ * 32, i * 32)),
          priority: decodeInt256(returnValue.slice(i++ * 32, i * 32))
        };
      }
    });
  }

  /**
   * Reward block validator
   * @param validator - Validator address
   * @param amount - Amount
   */
  reward(validator: Address, amount: BN) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('reward', ['address'], [validator.toString()], amount));
      return logs;
    });
  }

  /**
   * Slash block validator
   * @param validator - Validator address
   * @param reason - Slash reason
   */
  slash(validator: Address, reason: SlashReason) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('slash', ['address', 'uint8'], [validator.toString(), reason]));
      return logs;
    });
  }

  /**
   * After block call back
   * @param proposer - Proposer address
   * @param activeValidators - Address list of active validator
   * @param priorities - Priority list of active validator
   */
  onAfterBlock(proposer: Address, activeValidators: Address[], priorities: BN[]) {
    return this.runWithLogger(async () => {
      if (isEnableValidatorIds(this.common)) {
        const data = await Promise.all(
          activeValidators.map((address) => {
            const addr = address.toString();
            return this.executeMessage(this.makeSystemCallerMessage('validators', ['address'], [addr]));
          })
        );
        const ids = data.map((item) => {
          return decodeInt256(item.returnValue.slice(0 * 32, 1 * 32)).toNumber(); //get the first property
        });
        await this.executeMessage(this.makeSystemCallerMessage('onAfterBlockValidatorIds', ['address', 'bytes'], [proposer.toString(), validatorsEncode(ids, priorities)]));
      } else {
        await this.executeMessage(this.makeSystemCallerMessage('onAfterBlock', ['address', 'address[]', 'int256[]'], [proposer.toString(), activeValidators.map((addr) => addr.toString()), priorities.map((p) => p.toString())]));
      }
    });
  }
}
