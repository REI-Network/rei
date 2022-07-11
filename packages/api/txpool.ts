import { Controller } from './base';

export class TxPoolController extends Controller {
  txpool_content() {
    return this.backend.txPool.getPoolContent();
  }
}
