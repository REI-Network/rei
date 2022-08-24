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
    return this.ipcServer.rpcServer.isRunning === true;
  }

  /**
   * Start rpc server on given options
   */
  async startRpc() {
    if (!this.ipcServer.rpcServer.isRunning) {
      await this.ipcServer.rpcServer.start();
      return 'rpc server started';
    } else {
      throw new Error('rpc server is already running');
    }
  }

  /**
   * Stop rpc server
   */
  async stopRpc() {
    if (this.ipcServer.rpcServer.isRunning) {
      await this.ipcServer.rpcServer.abort();
      return 'rpc server stopped';
    } else {
      throw new Error('rpc server is not running');
    }
  }
}
