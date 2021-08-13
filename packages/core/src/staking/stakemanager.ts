import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, BN, MAX_INTEGER, setLengthLeft, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { hexStringToBuffer } from '@gxchain2/utils';
import { ValidatorInfo, ValidatorSet } from './validatorset';
import { bufferToAddress } from './utils';

// function selecot of stake manager
const methods = {
  indexedValidatorsLength: toBuffer('74a1c64a'),
  indexedValidatorsByIndex: toBuffer('af6a80e2'),
  validators: toBuffer('fa52c7d8'),
  getVotingPowerByIndex: toBuffer('9b8c4c88')
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

  private makeMessage(method: string, data: Buffer[]) {
    return new Message({
      caller: Address.zero(),
      to: Address.fromString(this.common.param('vm', 'smaddr')),
      gasLimit: MAX_INTEGER,
      data: Buffer.concat([methods[method], ...data])
    });
  }

  async deploy() {
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: Address.fromString(this.common.param('vm', 'smaddr')),
        gasLimit: MAX_INTEGER,
        // stakeManger code + configAddress + 000...40(rlp list) + genesisValidator1 + genesisValidator2 + ...
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'smcode')), hexStringToBuffer(this.common.param('vm', 'configaddr')), setLengthLeft(new Buffer('40', 'hex'), 32), ...(this.common.param('vm', 'genesisValidators') as string[]).map((addr) => setLengthLeft(hexStringToBuffer(addr), 32))])
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
    } = await this.evm.executeMessage(this.makeMessage('indexedValidatorsByIndex', [setLengthLeft(validator.buf, 32)]));
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
    return new ValidatorSet(validators, this.common);
  }
}
