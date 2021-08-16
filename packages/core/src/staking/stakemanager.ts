import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, BN, MAX_INTEGER, setLengthLeft, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { Receipt } from '@gxchain2/structure';
import { createBufferFunctionalMap, hexStringToBuffer } from '@gxchain2/utils';
import { ValidatorInfo, ValidatorSet, ValidatorChange } from './validatorset';
import { bufferToAddress } from './utils';

// function selector of stake manager
const methods = {
  indexedValidatorsLength: toBuffer('0x74a1c64a'),
  indexedValidatorsByIndex: toBuffer('0xaf6a80e2'),
  validators: toBuffer('0xfa52c7d8'),
  getVotingPowerByIndex: toBuffer('0x9b8c4c88')
};

// event topic
const events = {
  Stake: toBuffer('0x1bd1eb6b4fd3f08e718d7a241c54c4641c9f36004b6949383f48d15a2fcc8f52'),
  StartUnstake: toBuffer('0x020b3ba91672f551cfd1f7abf4794b3fb292f61fd70ffd5a34a60cdd04078e50'),
  SetCommissionRate: toBuffer('0xaa2933ee3941c066bda0e3f51e3e6ce63f33379daee1ef99baf018764d321e54')
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
  private evm!: EVM;
  private common!: Common;

  constructor(evm: EVM, common: Common) {
    this.evm = evm;
    this.common = common;
  }

  static filterValidatorChanges(receipts: Receipt[], common: Common) {
    const map = createBufferFunctionalMap<ValidatorChange>();
    const getVC = (validator: Address) => {
      let vc = map.get(validator.buf);
      if (!vc) {
        vc = {
          validator: validator,
          stake: [],
          unstake: []
        };
        map.set(validator.buf, vc);
      }
      return vc;
    };

    const smaddr = bufferToAddress(hexStringToBuffer(common.param('vm', 'smaddr')));
    for (const receipt of receipts) {
      for (const log of receipt.logs) {
        console.log('log:', log);
        if (log.address.equals(smaddr.buf)) {
          if (log.topics.length === 3 && log.topics[0].equals(events['Stake'])) {
            // Stake event
            const value = new BN(log.topics[2]);
            const validator = bufferToAddress(log.topics[1]);
            const vc = getVC(validator);
            vc.stake.push(value);
          } else if (log.topics.length === 4 && log.topics[0].equals(events['StartUnstake'])) {
            // StartUnstake event
            const value = new BN(log.topics[3]);
            const validator = bufferToAddress(log.topics[2]);
            const vc = getVC(validator);
            vc.unstake.push(value);
          } else if (log.topics.length === 4 && log.topics[0].equals(events['SetCommissionRate'])) {
            // SetCommissionRate event
            const commissionRate = new BN(log.topics[2]);
            const updateTimestamp = new BN(log.topics[3]);
            const validator = bufferToAddress(log.topics[1]);
            const vc = getVC(validator);
            vc.commissionChange = {
              commissionRate,
              updateTimestamp
            };
          }
        }
      }
    }

    return Array.from(map.values());
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

  async createValidatorSet() {
    const validators: ValidatorInfo[] = [];
    const length = await this.indexedValidatorsLength();
    for (let i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await this.indexedValidatorsByIndex(i);
      const votingPower = await this.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        validators.push({ validator, votingPower });
      }
    }
    return ValidatorSet.createFromValidatorInfo(validators, this.common);
  }
}
