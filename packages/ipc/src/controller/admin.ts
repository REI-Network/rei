import { IpcServer } from '../server';
/**
 * Txpool api Controller
 */
export class AdminController {
  readonly ipcServer: IpcServer;

  constructor(ipcServer: IpcServer) {
    this.ipcServer = ipcServer;
  }

  /**
   * Returns the status of rpc server
   * @returns true if rpc server is running otherwise false
   */
  rpcRunning() {
    return this.ipcServer.apiServer.rpcRunning();
  }

  /**
   * Start rpc server on given options
   */
  async startRpc() {
    return this.ipcServer.apiServer.startRpc();
  }

  /**
   * Stop rpc server
   */
  async stopRpc() {
    return this.ipcServer.apiServer.stopRpc();
  }

  /**
   * Add static peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  async addPeer([enrTxt]: [string]) {
    return this.ipcServer.apiServer.addPeer(enrTxt);
  }

  /**
   * Disconnect remote peer
   * @param enrTxt - ENR string
   * @returns True if added sucessfully
   */
  async removePeer([enrTxt]: [string]) {
    return this.ipcServer.apiServer.removePeer(enrTxt);
  }

  /**
   * Add trusted peer,
   * network manager will always accept connection from trusted peers,
   * even if the number of connections is full
   * @param enrTxt - ENR string
   * @returns Whether the trusted node is added successfully
   */
  async addTrustedPeer([enrTxt]: [string]) {
    return this.ipcServer.apiServer.addTrustedPeer(enrTxt);
  }

  /**
   * Remove trusted peer,
   * NOTE: this method does not immediately modify peerValue
   * @param enrTxt - ENR string
   * @returns Whether the deletion of the trust node is successful
   */
  async removeTrutedPeer([enrTxt]: [string]) {
    return this.ipcServer.apiServer.removeTrutedPeer(enrTxt);
  }

  /**
   * Get connected peers
   * @returns Peers information
   */
  async peers() {
    return this.ipcServer.apiServer.peers();
  }

  /**
   * Get local node info
   * @returns local node info
   */
  async nodeInfo() {
    return this.ipcServer.apiServer.nodeInfo();
  }

  /**
   * Check remote peer is trusted
   * @param enrTxt - ENR string
   * @returns Whether it is a trusted node
   */
  async isTrusted([enrTxt]: [string]) {
    return this.ipcServer.apiServer.isTrusted(enrTxt);
  }
}
