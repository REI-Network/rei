import { RpcServer } from '@rei-network/rpc';
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
    const state = this.ipcServer.rpcServer !== undefined && this.ipcServer.rpcServer.isRunning === true;
    return state;
  }

  /**
   * Start rpc server on given options
   */
  startRpc(port?: number, host?: string, apis?: string) {
    if (this.ipcServer.rpcServer === undefined) {
      this.ipcServer.rpcServer = new RpcServer({ apiServer: this.ipcServer.apiServer, port, host, apis });
    } else {
      throw new Error('rpc server is already running');
    }
  }

  /**
   * Stop rpc server
   */
  async stopRpc() {
    if (this.ipcServer.rpcServer !== undefined) {
      await this.ipcServer.rpcServer.abort();
      this.ipcServer.rpcServer = undefined;
    }
  }
}
