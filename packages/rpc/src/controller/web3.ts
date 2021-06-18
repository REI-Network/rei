import { bufferToHex, keccakFromHexString } from 'ethereumjs-util';
import { Controller } from './base';

export class Web3Controller extends Controller {
  web3_clientVersion() {
    return 'Mist/v0.0.1';
  }
  web_sha3([data]: [string]) {
    return bufferToHex(keccakFromHexString(data));
  }
}
