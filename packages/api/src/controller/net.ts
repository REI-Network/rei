import { intToHex } from 'ethereumjs-util';
import { Controller } from './base';

/**
 * Net api Controller
 */
export class NetController extends Controller {
  /**
   * Get the current network id
   * @returns Network id
   */
  version() {
    return this.node.chainId.toString();
  }

  /**
   * Returns true if client is actively listening for network connections
   * @returns network connections state
   */
  listening() {
    return true;
  }

  /**
   * Returns number of peers currently connected to the client
   * @returns number of peers
   */
  peerCount() {
    return intToHex(this.node.networkMngr.peers.length);
  }
}
