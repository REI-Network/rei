import { intToHex } from 'ethereumjs-util';
import { Controller } from './base';

export class NetController extends Controller {
  net_version() {
    return this.backend.chainId.toString();
  }
  net_listenging() {
    return true;
  }
  net_peerCount() {
    return intToHex(this.backend.networkMngr.peers.length);
  }
}
