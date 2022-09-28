import EVM from '@rei-network/vm/dist/evm/evm';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Contract } from './contract';

type MissReord = {
  address: Address;
  missRoundNumber: BN;
};
// function selector of jail contract
const methods = {
  addMissRecord: toBuffer('0x18498f3a'),
  getMinerByIndex: toBuffer('0x3d19ab13'),
  getMissedRoundNumberPeriodByIndex: toBuffer('0x67e23785'),
  getMinersLength: toBuffer('0x23ff9c6a'),
  jail: toBuffer('0x9bcbea52'),
  lowestRecordBlockNumber: toBuffer('0x3796c54e')
};

const events = {
  Jail: toBuffer('be3aa33bd245135e4e26b223d79d14ea479a47bff09f2b03c53838af1edbb14b'),
  Unjail: toBuffer('0x392ade2e433ab375e4a081f278116373f992aa104889accb306abf71042e70d8'),
  AddMissRecord: toBuffer('0x09643018f0ec0338f3696cccd484fec7a3fa3c1faf64a61b58e61d901bcbbc69')
};

// a class used to interact with jail contract
export class Prison extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'praddr')));
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

  /**
   * Get miner missed round number period now by index
   * @param index - Miner index
   * @returns missed round number period now
   */
  getMinerMissedRoundNumberPeriod(index: BN) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getMissedRoundNumberPeriodByIndex', ['uint256'], [index.toString()]));
      return new BN(returnValue);
    });
  }

  /**
   * Get lowest record block number
   * @returns lowest record block number
   */
  lowestRecordBlockNumber() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('lowestRecordBlockNumber', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Jail miner
   * @param miner - Miner address
   * @returns
   */
  jail(miner: Address) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('jail', ['address'], [miner.toString()]));
      return logs;
    });
  }

  /**
   * Add miss record to persion contract per block
   * @param missReord - Miss record
   * @returns
   */
  addMissRecord(missReord: MissReord[]) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(
        this.makeSystemCallerMessage(
          'addMissRecord',
          ['tuple(address,uint256)[]'],
          [
            missReord.map((record) => {
              return [record.address.toString(), record.missRoundNumber.toString()];
            })
          ]
        )
      );
      return logs;
    });
  }
}
