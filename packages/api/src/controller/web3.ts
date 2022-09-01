import { bufferToHex, keccakFromHexString } from 'ethereumjs-util';
import { Controller } from './base';

/**
 * Web3 api Controller
 */
export class Web3Controller extends Controller {
  /**
   * Get client version
   * @returns version data
   */
  clientVersion() {
    return 'Mist/v0.0.1';
  }

  /**
   * Calulate the sha3 of a given string
   * @param data - Data to calulate hash
   * @returns Hash
   */
  sha3([data]: [string]) {
    return bufferToHex(keccakFromHexString(data));
  }
}
