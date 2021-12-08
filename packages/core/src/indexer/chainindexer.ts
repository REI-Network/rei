import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Channel, logger } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { Initializer } from '../types';
import { ChainIndexerBackend, ChainIndexerOptions } from './types';

/**
 * ChainIndexer does a post-processing job for equally sized sections of the canonical chain
 * (like BlooomBits).
 *
 * Further child ChainIndexers can be added which use the output of the parent section indexer.
 * These child indexers receive new head notifications only after an entire section has been finished
 * or in case of rollbacks that might affect already finished sections.
 */
export class ChainIndexer extends Initializer {
  private readonly db: Database;
  private readonly backend: ChainIndexerBackend;
  private readonly sectionSize: number;
  private readonly confirmsBlockNumber: number;
  private readonly headerQueue: Channel<BlockHeader>;

  private storedSections?: BN;
  private processHeaderLoopPromise?: Promise<void>;

  constructor(options: ChainIndexerOptions) {
    super();
    this.db = options.db;
    this.backend = options.backend;
    this.sectionSize = options.sectionSize;
    this.confirmsBlockNumber = options.confirmsBlockNumber;
    this.headerQueue = new Channel<BlockHeader>({ max: 1 });
  }

  async init() {
    this.storedSections = await this.db.getStoredSectionCount();
    this.initOver();
  }

  start() {
    this.initPromise.then(() => {
      this.processHeaderLoopPromise = this.processHeaderLoop();
    });
  }

  async abort() {
    this.headerQueue.abort();
    await this.processHeaderLoopPromise;
  }

  async newBlockHeader(header: BlockHeader) {
    await this.initPromise;
    this.headerQueue.push(header);
  }

  /**
   * Process new block header, if it forks, do reorganize
   */
  private async processHeaderLoop() {
    await this.initPromise;
    let preHeader: BlockHeader | undefined;
    for await (const header of this.headerQueue.generator()) {
      try {
        if (preHeader !== undefined && !header.parentHash.equals(preHeader.hash())) {
          const ancestor = await this.db.findCommonAncestor(header, preHeader);
          await this.newHeader(ancestor.number, true);
        }
        await this.newHeader(header.number, false);
        preHeader = header;
      } catch (err) {
        logger.error('ChainIndexer::processHeaderLoop, catch error:', err);
      }
    }
  }

  /**
   * NewHeader notifies the indexer about new chain heads and/or reorgs.
   * @param number Block number of newheader
   * @param reorg If a reorg happened, invalidate all sections until that point
   */
  private async newHeader(number: BN, reorg: boolean) {
    let confirmedSections: BN | undefined = number.gtn(this.confirmsBlockNumber) ? number.subn(this.confirmsBlockNumber).divn(this.sectionSize) : new BN(0);
    confirmedSections = confirmedSections.gtn(0) ? confirmedSections.subn(1) : undefined;
    if (reorg) {
      if (confirmedSections === undefined) {
        await this.backend.prune(new BN(0));
        this.storedSections = undefined;
      } else if (this.storedSections === undefined || !confirmedSections.eq(this.storedSections)) {
        await this.backend.prune(confirmedSections);
        this.storedSections = confirmedSections.clone();
      }
      await this.db.setStoredSectionCount(this.storedSections);
      return;
    }
    if (confirmedSections !== undefined && (this.storedSections === undefined || confirmedSections.gt(this.storedSections))) {
      for (const currentSections = this.storedSections ? this.storedSections.clone() : new BN(0); confirmedSections.gte(currentSections); currentSections.iaddn(1)) {
        this.backend.reset(currentSections);
        let lastHeader = currentSections.gtn(0) ? await this.db.getCanonicalHeader(currentSections.muln(this.sectionSize).subn(1)) : undefined;
        // the first header number of the next section.
        const maxNum = currentSections.addn(1).muln(this.sectionSize);
        for (const num = currentSections.muln(this.sectionSize); num.lt(maxNum); num.iaddn(1)) {
          const header = await this.db.getCanonicalHeader(num);
          if (lastHeader !== undefined && !header.parentHash.equals(lastHeader.hash())) {
            throw new Error(`parentHash is'not match, last: ${lastHeader.number.toString()}, current: ${header.number.toString()}`);
          }
          await this.backend.process(header);
          lastHeader = header;
        }
        await this.backend.commit();
        // save stored section count.
        await this.db.setStoredSectionCount(currentSections);
        this.storedSections = currentSections.clone();
      }
    }
  }
}
