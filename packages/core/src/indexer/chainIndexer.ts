import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Channel, logger } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { DBSaveBloomBitsSectionCount } from '@rei-network/database/dist/helpers';
import { EMPTY_HASH } from '../utils';
import { ChainIndexerBackend, ChainIndexerOptions } from './types';

type IndexTask = {
  header: BlockHeader;
  resolve?: () => void;
};

/**
 * ChainIndexer does a post-processing job for equally sized sections of the canonical chain
 * (like BlooomBits).
 *
 * Further child ChainIndexers can be added which use the output of the parent section indexer.
 * These child indexers receive new head notifications only after an entire section has been finished
 * or in case of rollbacks that might affect already finished sections.
 */
export class ChainIndexer {
  private readonly db: Database;
  private readonly backend: ChainIndexerBackend;
  private readonly sectionSize: number;
  private readonly confirmsBlockNumber: number;
  private readonly headerQueue: Channel<IndexTask>;

  private storedSections?: BN;
  private processHeaderLoopPromise?: Promise<void>;
  private initPromise?: Promise<void>;

  constructor(options: ChainIndexerOptions) {
    this.db = options.db;
    this.backend = options.backend;
    this.sectionSize = options.sectionSize;
    this.confirmsBlockNumber = options.confirmsBlockNumber;
    this.headerQueue = new Channel<IndexTask>({ drop: ({ resolve }) => resolve && resolve() });
  }

  /**
   * Init ChainIndexer
   */
  init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    return (this.initPromise = (async () => {
      this.storedSections = await this.db.getStoredSectionCount();
    })());
  }

  /**
   * Start index loop
   */
  start() {
    this.processHeaderLoopPromise = this.processHeaderLoop();
  }

  /**
   * Abort index loop
   */
  async abort() {
    this.headerQueue.abort();
    await this.processHeaderLoopPromise;
  }

  /**
   * Add a new index task to queue
   * @param header - New block header
   * @param force - Force set header
   */
  async newBlockHeader(header: BlockHeader, force: boolean = false) {
    await this.initPromise;
    if (!force) {
      this.headerQueue.push({ header });
    } else {
      await new Promise<void>((resolve) => {
        this.headerQueue.push({ header, resolve });
      });
    }
  }

  /**
   * Process new block header, if it forks, do reorganize
   */
  private async processHeaderLoop() {
    await this.initPromise;
    for await (const { header, resolve } of this.headerQueue) {
      try {
        await this.newHeader(header.number);
      } catch (err) {
        logger.error('ChainIndexer::processHeaderLoop, catch error:', err);
      } finally {
        resolve && resolve();
      }
    }
  }

  /**
   * NewHeader notifies the indexer about new chain heads and/or reorgs.
   * @param number - Block number of newheader
   */
  private async newHeader(number: BN) {
    let confirmedSections: BN | undefined = number.gtn(this.confirmsBlockNumber) ? number.subn(this.confirmsBlockNumber).divn(this.sectionSize) : new BN(0);
    confirmedSections = confirmedSections.gtn(0) ? confirmedSections.subn(1) : undefined;
    if (confirmedSections !== undefined && (this.storedSections === undefined || confirmedSections.gt(this.storedSections))) {
      for (const currentSections = this.storedSections ? this.storedSections.clone() : new BN(0); confirmedSections.gte(currentSections); currentSections.iaddn(1)) {
        this.backend.reset(currentSections);
        let lastHeader: BlockHeader | undefined;
        if (currentSections.gtn(0)) {
          try {
            lastHeader = await this.db.getCanonicalHeader(currentSections.muln(this.sectionSize).subn(1));
          } catch (err) {
            // ignore errors...
          }
        }
        // the first header number of the next section.
        const maxNum = currentSections.addn(1).muln(this.sectionSize);
        for (const num = currentSections.muln(this.sectionSize); num.lt(maxNum); num.iaddn(1)) {
          let header: BlockHeader | undefined;
          try {
            header = await this.db.getCanonicalHeader(num);
          } catch (err) {
            // ignore errors...
          }
          if (lastHeader !== undefined && header !== undefined && !header.parentHash.equals(lastHeader.hash())) {
            throw new Error(`parentHash is'not match, last: ${lastHeader.number.toString()}, current: ${header.number.toString()}`);
          }
          const number = header?.number ?? num;
          const bloom = header?.bloom ?? Buffer.alloc(256);
          const hash = header?.hash() ?? EMPTY_HASH;
          this.backend.process(number, bloom, hash);
          lastHeader = header;
        }
        const batch = this.backend.commit();
        // save stored section count.
        await this.db.batch([...batch, DBSaveBloomBitsSectionCount(currentSections)]);
        this.storedSections = currentSections.clone();
      }
    }
  }
}
