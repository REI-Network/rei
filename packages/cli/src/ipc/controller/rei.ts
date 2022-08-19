import { ApiServer } from '@rei-network/api';
import { IpcServer } from '../server';
/**
 * Rei api Controller
 */
export class ReiController {
  readonly apiServer: ApiServer;

  constructor(ipcServer: IpcServer) {
    this.apiServer = ipcServer.apiServer;
  }

  /**
   * Estimate user available crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Available crude
   */
  async getCrude([address, tag]: [string, string]) {
    return this.apiServer.getCrude(address, tag);
  }

  /**
   * Estimate user used crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Used crude
   */
  async getUsedCrude([address, tag]: [string, string]) {
    return this.apiServer.getUsedCrude(address, tag);
  }

  /**
   * Get the total deposit amount of the user
   * @param address - Target address
   * @param tag - Block tag
   * @returns Total deposit amount
   */
  async getTotalAmount([address, tag]: [string, string]) {
    return this.apiServer.getTotalAmount(address, tag);
  }

  /**
   * Read "dailyFee" settings from common
   * @param tag - Block tag
   * @returns Daily fee
   */
  async getDailyFee([tag]: [string]) {
    return this.apiServer.getDailyFee(tag);
  }

  /**
   * Read "minerRewardFactor" settings from common
   * @param tag - Block tag
   * @returns Miner reward factor
   */
  async getMinerRewardFactor([tag]: [string]) {
    return this.apiServer.getMinerRewardFactor(tag);
  }
}
