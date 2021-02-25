import EthereumCommon, { CommonOpts } from '@ethereumjs/common';
import * as constants from './constants';
import { hardforks as HARDFORK_CHANGES } from './hardforks';

export class Common extends EthereumCommon {
  // TODO: set POA property to genesis chain params
  private readonly POA: Buffer[];

  constructor(opts: CommonOpts, POA?: Buffer[]) {
    super(opts);
    this.POA = POA || [];
  }

  isValidPOA(address: Buffer) {
    return !!this.POA.find((b) => address.equals(b));
  }

  /**
   * Returns the parameter corresponding to a hardfork
   * @param topic Parameter topic ('gasConfig', 'gasPrices', 'vm', 'pow')
   * @param name Parameter name (e.g. 'minGasLimit' for 'gasConfig' topic)
   * @param hardfork Hardfork name
   * @returns The value requested or `null` if not found
   */
  paramByHardfork(topic: string, name: string, hardfork: string): any {
    hardfork = this._chooseHardfork(hardfork);

    let value = null;
    for (const hfChanges of HARDFORK_CHANGES) {
      // EIP-referencing HF file (e.g. berlin.json)
      if (hfChanges[1].hasOwnProperty('eips')) { // eslint-disable-line
        const hfEIPs = hfChanges[1]['eips'];
        for (const eip of hfEIPs) {
          const valueEIP = this.paramByEIP(topic, name, eip);
          value = valueEIP !== null ? valueEIP : value;
        }
        // Paramater-inlining HF file (e.g. istanbul.json)
      } else {
        if (!hfChanges[1][topic]) {
          throw new Error(`Topic ${topic} not defined`);
        }
        if (hfChanges[1][topic][name] !== undefined) {
          value = hfChanges[1][topic][name].v;
        }
      }
      if (hfChanges[0] === hardfork) break;
    }
    return value;
  }
}

export * from './genesis';
export { constants };
