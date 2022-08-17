import { ApiServer } from '@rei-network/api';

/**
 * Txpool api Controller
 */
export class AdminController {
  readonly apiServer: ApiServer;

  constructor(apiServer: ApiServer) {
    this.apiServer = apiServer;
  }
}
