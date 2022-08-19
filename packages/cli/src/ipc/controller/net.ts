import { ApiServer } from '@rei-network/api';
import { IpcServer } from '../server';
/**
 * Net api Controller
 */
export class NetController {
  readonly apiServer: ApiServer;

  constructor(ipcServer: IpcServer) {
    this.apiServer = ipcServer.apiServer;
  }

  /**
   * Get the current network id
   * @returns Network id
   */
  version() {
    return this.apiServer.version();
  }

  /**
   * Returns true if client is actively listening for network connections
   * @returns Network connections state
   */
  listenging() {
    return this.apiServer.listening();
  }

  /**
   * Returns number of peers currently connected to the client
   * @returns Number of connected peers
   */
  peerCount() {
    return this.apiServer.peerCount();
  }
}
