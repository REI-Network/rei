import { BN } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { FunctionalBufferSet, hexStringToBuffer } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { BlockHeader } from '@rei-network/structure';
import { isEnableHardfork2 } from '../../hardforks';
import { ExtraData } from './extraData';

/**
 * EvidenceCollector will collect hashes of all packed evidences and record them in memory.
 * The collected hashes will be used for hard fork upgrades.
 */
export class EvidenceCollector {
  private initHeight: number = 0;
  private currentHeight!: BN;
  private hashes = new FunctionalBufferSet();

  constructor(_common: Common) {
    const common = _common.copy();
    if (common.chainName() === 'rei-mainnet') {
      common.setHardfork('mainnet-hf-2');
    } else if (common.chainName() === 'rei-testnet') {
      common.setHardfork('testnet-hf-2');
    } else {
      return;
    }

    // load init height from common
    const initHeight = common.param('vm', 'initHeight');
    if (typeof initHeight !== 'number') {
      throw new Error('invalid initHeight');
    }
    this.initHeight = initHeight;

    // load init hashes from common
    const initHashes = common.param('vm', 'initHashes');
    if (!Array.isArray(initHashes)) {
      throw new Error('invalid initHashes');
    }
    initHashes.map(hexStringToBuffer).forEach((hash) => this.hashes.add(hash));
  }

  /**
   * Load evidence from database
   * @param latestHeight - Latest block height
   * @param db - Database instance
   */
  async init(latestHeight: BN, db: Database) {
    for (let i = this.initHeight + 1; latestHeight.gten(i); i++) {
      const header = await db.getCanonicalHeader(new BN(i));
      const extraData = ExtraData.fromBlockHeader(header);
      this.newBlockHeader(extraData, header);
    }
    this.currentHeight = latestHeight.clone();
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
   * @param extraData - Extra data object
   * @param header - Block header
   */
  newBlockHeader(extraData: ExtraData, header: BlockHeader) {
    const chainName = header._common.chainName();
    if (chainName !== 'rei-mainnet' && chainName !== 'rei-testnet') {
      // ignore other chains
      return;
    }
    if (isEnableHardfork2(header._common)) {
      // the hard fork has been upgraded and hash collection is no longer required
      return;
    }
    if (header.number.lten(this.initHeight)) {
      // has not reached the height of initialization, no need to collect
      return;
    }
    extraData.evidence.forEach((ev) => {
      this.hashes.add(ev.hash());
    });
    this.currentHeight = header.number.clone();
  }
}
