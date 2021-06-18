import { Controller } from './base';

export class TxPoolController extends Controller {
  txpool_content() {
    return this.node.txPool.getPoolContent();
  }
}
