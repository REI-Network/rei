import { ApiServer } from '@rei-network/api';

/**
 * Web3 api Controller
 */
export class Web3Controller {
  readonly apiServer: ApiServer;

  constructor(apiServer: ApiServer) {
    this.apiServer = apiServer;
  }

  /**
   * Get client version
   * @returns version data
   */
  clientVersion() {
    return this.apiServer.clientVersion();
  }

  /**
   * Calulate the sha3 of a given string
   * @param data - data to calculate
   * @returns Hash
   */
  sha3([data]: [string]) {
    return this.apiServer.sha3(data);
  }
}
