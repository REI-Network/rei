import { ApiServer } from '@rei-network/api';
import { IpcServer } from '../server';

/**
 * Txpool api Controller
 */
export class TxPoolController {
  readonly apiServer: ApiServer;

  constructor(ipcServer: IpcServer) {
    this.apiServer = ipcServer.apiServer;
  }

  /**
   * Get total pool content
   * @returns An object containing all transactions in the pool
   */
  content() {
    return this.apiServer.content();
  }
}
