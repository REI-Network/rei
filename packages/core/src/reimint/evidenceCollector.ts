import { BN } from 'ethereumjs-util';
import { FunctionalBufferSet, hexStringToBuffer } from '@rei-network/utils';

/**
 * EvidenceCollector will collect hashes of all packed evidences and record them in memory.
 * The collected hashes will be used for hard fork upgrades.
 */
export class EvidenceCollector {
  initHeight = 0;
  currentHeight!: BN;
  hashes = new FunctionalBufferSet();

  constructor(initHeight: number, initHashes: string[]) {
    this.initHeight = initHeight;
    initHashes.map(hexStringToBuffer).forEach((hash) => this.hashes.add(hash));
  }

  /**
   * Load evidence from database
   * @param latestHeight - Latest block height
   * @param load - Load header and evidence callback
   */
  async init(latestHeight: BN, load: (height: BN) => Promise<Buffer[]>) {
    this.currentHeight = new BN(this.initHeight);
    for (let i = new BN(this.initHeight + 1); i.lte(latestHeight); i.iaddn(1)) {
      this.newBlockHeader(i, await load(i));
    }
  }

  /**
   * Get all collected evidence hashes
   * @param height - Current height
   * @returns Hash list
   */
  getHashes(height: BN) {
    if (!height.eq(this.currentHeight)) {
      throw new Error('height mismatch');
    }
    return Array.from(this.hashes);
  }

  /**
   * Notify EvidenceCollector when a new block header is received
   * @param height - Latest block height
   * @param hashes = Evidence hashes
   */
  newBlockHeader(height: BN, hashes: Buffer[]) {
    if (height.lten(this.initHeight)) {
      // has not reached the height of initialization, no need to collect
      return;
    }
    if (!height.subn(1).eq(this.currentHeight)) {
      throw new Error('invalid block number');
    }
    // update current height
    this.currentHeight = height.clone();
    // save evidence hashes
    for (const hash of hashes) {
      this.hashes.add(hash);
    }
  }
}
