import { Controller } from './base';

/**
 * Admin api Controller
 */
export class AdminController extends Controller {
  rpcRunning() {
    return this.rpcServer.isRunning;
  }

  /**
   * Start rpc server on given options
   */
  async startRpc([host, port]: [string?, number?]) {
    if (!this.rpcRunning()) {
      this.rpcServer.reset(host ? host : this.rpcServer.host, port ? port : this.rpcServer.port);
      await this.rpcServer.start();
      return `rpc server started sucessfully at ${this.rpcServer.host}:${this.rpcServer.port}`;
    } else {
      throw new Error(`rpc server is already running at ${this.rpcServer.host}:${this.rpcServer.port}`);
    }
  }

  /**
   * Stop rpc server
   */
  async stopRpc() {
    if (this.rpcRunning()) {
      await this.rpcServer!.abort();
      return 'rpc server stopped sucessfully';
    } else {
      throw new Error('rpc server is not running');
    }
  }

  /**
   * Add static peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  async addPeer([enrTxt]: [string]) {
    return this.node.networkMngr.addPeer(enrTxt);
  }

  /**
   * Disconnect remote peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  async removePeer([enrTxt]: [string]) {
    return this.node.networkMngr.removeStaticPeer(enrTxt);
  }

  /**
   * Add trusted peer,
   * network manager will always accept connection from trusted peers,
   * even if the number of connections is full
   * @param enrTxt - ENR string
   * @returns Whether the trusted node is added successfully
   */
  async addTrustedPeer([enrTxt]: [string]) {
    return this.node.networkMngr.addTrustedPeer(enrTxt);
  }

  /**
   * Remove trusted peer,
   * NOTE: this method does not immediately modify peerValue
   * @param enrTxt - ENR string
   * @returns Whether the deletion of the trust node is successful
   */
  async removeTrutedPeer([enrTxt]: [string]) {
    return this.node.networkMngr.removeTrustedPeer(enrTxt);
  }

  /**
   * Get connected peers
   * @returns Peers information
   */
  async peers() {
    return this.node.networkMngr.connectedPeers;
  }

  /**
   * Get local node info
   * @returns local node info
   */
  async nodeInfo() {
    return this.node.networkMngr.nodeInfo;
  }

  /**
   * Check remote peer is trusted
   * @param enrTxt - ENR string
   * @returns Whether it is a trusted node
   */
  async isTrusted([enrTxt]: [string]) {
    return this.node.networkMngr.isTrusted(enrTxt);
  }
}
