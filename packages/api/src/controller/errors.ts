import { BN } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';

const coder = new AbiCoder();

export class RevertError {
  readonly returnValue: string | Buffer;
  readonly decodedReturnValue?: string;

  constructor(returnValue: Buffer | string) {
    this.returnValue = returnValue;
    if (Buffer.isBuffer(returnValue)) {
      this.decodedReturnValue = coder.decode(
        ['string'],
        returnValue.slice(4)
      )[0];
    }
  }
}

export class OutOfGasError {
  readonly gas: BN;

  constructor(gas: BN) {
    this.gas = gas.clone();
  }
}
