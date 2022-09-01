import { Controller } from './base';

/**
 * Txpool api Controller
 */
export class TxPoolController extends Controller {
  /**
   * Get total pool content
   * @returns An object containing all transactions in the pool
   */
  content() {
    return this.node.txPool.getPoolContent();
  }
}
