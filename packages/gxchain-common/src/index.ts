import EthereumJSCommon, { CommonOpts } from '@ethereumjs/common';
import * as constants from './constants';

export class Common extends EthereumJSCommon {
  // TODO: set POA property to genesis chain params
  private readonly POA: Buffer[];

  constructor(opts: CommonOpts, POA?: Buffer[]) {
    super(opts);
    this.POA = POA || [];
  }

  isValidPOA(address: Buffer) {
    return !!this.POA.find((b) => address.equals(b));
  }
}

export * from './genesis';
export { constants };
