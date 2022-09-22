import EVM from '@rei-network/vm/dist/evm/evm';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Contract } from './contract';

type missReord = {
  address: Address;
  missRoundNumber: BN;
};
// function selector of jail contract
const methods = {
  addMissRecord: toBuffer('0x18498f3a'),
  getMinerByIndex: toBuffer('0x3d19ab13'),
  getMissedRoundNumberPeriodByIndex: toBuffer('67e23785'),
  getMinersLength: toBuffer('0x23ff9c6a'),
  jail: toBuffer('0x9bcbea52'),
  lowestRecordBlockNumber: toBuffer('0x3796c54e')
};

const events = {
  Dojail: toBuffer('0x120c0e1915a6c9ceb3027875dc2b7d18e149282bd56fcb5212c412f4fbbe7d03'),
  Unjail: toBuffer('0x392ade2e433ab375e4a081f278116373f992aa104889accb306abf71042e70d8'),
  AddMissRecord: toBuffer('0x09643018f0ec0338f3696cccd484fec7a3fa3c1faf64a61b58e61d901bcbbc69'),
  ResetRecordsAmountPeriod: toBuffer('0xcba078451f52ffceb15f09fe5e19598b358ac24052b9ae82ae81e997e17bb9cb')
};

// a class used to interact with jail contract
export class Jail extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'jladdr')));
  }

  /**
   * Get miners length
   * @returns  miners length
   */
  getMinersLength() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getMinersLength', [], []));
      return new BN(returnValue);
    });
  }

  getMinerMissedRoundNumberPeriod(index: BN) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getMissedRoundNumberPeriodByIndex', ['uint256'], [index.toString()]));
      return new BN(returnValue);
    });
  }

  lowestRecordBlockNumber() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('lowestRecordBlockNumber', [], []));
      return new BN(returnValue);
    });
  }

  jail(miner: Address) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('jail', ['address'], [miner.toString()]));
      return logs;
    });
  }

  addMissRecord(missReord: missReord[]) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('addMissRecord', ['address', 'uint256'], [missReord[0].address.toString(), missReord[0].missRoundNumber.toString()]));
    });
  }
}
