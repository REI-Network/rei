import { ApiServer } from '@rei-network/api';

/**
 * Txpool api Controller
 */
export class TxPoolController {
  readonly apiServer: ApiServer;

  constructor(apiServer: ApiServer) {
    this.apiServer = apiServer;
  }

  /**
   * Get total pool content
   * @returns An object containing all transactions in the pool
   */
  txpool_content() {
    return this.apiServer.content();
  }
}
