import { bufferToHex, toBuffer } from 'ethereumjs-util';
import { Controller } from './base';

export class NetController extends Controller {
  net_version() {
    return '77';
  }
  net_listenging() {
    return true;
  }
  net_peerCount() {
    return bufferToHex(toBuffer(this.node.peerpool.peers.length));
  }
}
