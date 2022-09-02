import { Controller } from './base';

/**
 * Admin api Controller
 */
export class AdminController extends Controller {
  /**
   * Get connected peers
   * @returns Peers information
   */
  peers() {
    return this.node.networkMngr.connectedPeers;
  }

  /**
   * Get local node info
   * @returns local node info
   */
  nodeInfo() {
    return this.node.networkMngr.nodeInfo;
  }

  /**
   * Get whether the RPC service is running
   */
  rpcRunning() {
    return this.rpcServer.isRunning;
  }

  /**
   * Start rpc server on given options
   */
  async startRPC([host, port]: [string?, number?]) {
    if (!this.rpcRunning()) {
      if (host && port) {
        this.rpcServer.reset(host, port);
      }
      await this.rpcServer.start();
      return true;
    } else {
      return false;
    }
  }

  /**
   * Stop rpc server
   */
  async stopRPC() {
    if (this.rpcRunning()) {
      await this.rpcServer.abort();
      return true;
    } else {
      return false;
    }
  }

  /**
   * Add static peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  addPeer([enrTxt]: [string]) {
    return this.node.networkMngr.addStaticPeer(enrTxt);
  }

  /**
   * Disconnect remote peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  removePeer([enrTxt]: [string]) {
    return this.node.networkMngr.removeStaticPeer(enrTxt);
  }

  /**
   * Add trusted peer,
   * network manager will always accept connection from trusted peers,
   * even if the number of connections is full
   * @param enrTxt - ENR string
   * @returns Whether the trusted node is added successfully
   */
  addTrustedPeer([enrTxt]: [string]) {
    return this.node.networkMngr.addTrustedPeer(enrTxt);
  }

  /**
   * Remove trusted peer,
   * NOTE: this method does not immediately modify peerValue
   * @param enrTxt - ENR string
   * @returns Whether the deletion of the trust node is successful
   */
  removeTrutedPeer([enrTxt]: [string]) {
    return this.node.networkMngr.removeTrustedPeer(enrTxt);
  }

  /**
   * Check remote peer is trusted
   * @param enrTxt - ENR string
   * @returns Whether it is a trusted node
   */
  isTrusted([enrTxt]: [string]) {
    return this.node.networkMngr.isTrusted(enrTxt);
  }
}
