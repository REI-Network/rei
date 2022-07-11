import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Channel, logger } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { DBSaveBloomBitsSectionCount, DBDeleteBloomBitsSectionCount } from '@rei-network/database/dist/helpers';
import { EMPTY_HASH } from '../utils';
import { ChainIndexerBackend, ChainIndexerOptions } from './types';

type IndexTask = {
  header: BlockHeader;
  force: boolean;
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
    this.headerQueue = new Channel<IndexTask>({ max: 1, drop: ({ resolve }) => resolve && resolve() });
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
      this.headerQueue.push({ header, force });
    } else {
      await new Promise<void>((resolve) => {
        this.headerQueue.push({ header, force, resolve });
      });
    }
  }

  /**
   * Find the common ancestor block of two forks
   * @param header1 - Header of fork1
   * @param header2 - Header of fork2
   * @returns Ancestor block header
   */
  private async findCommonAncestor(header1: BlockHeader, header2: BlockHeader) {
    while (header1.number.gt(header2.number)) {
      header1 = await this.db.getHeader(header1.parentHash, header1.number.subn(1));
    }
    while (header2.number.gt(header1.number)) {
      header2 = await this.db.getHeader(header2.parentHash, header2.number.subn(1));
    }
    while (!header1.hash().equals(header2.hash()) && header1.number.gtn(0) && header2.number.gtn(0)) {
      header1 = await this.db.getHeader(header1.parentHash, header1.number.subn(1));
      header2 = await this.db.getHeader(header2.parentHash, header2.number.subn(1));
    }
    if (!header1.hash().equals(header2.hash())) {
      throw new Error('find common ancestor failed');
    }
    return header1;
  }

  /**
   * Process new block header, if it forks, do reorganize
   */
  private async processHeaderLoop() {
    await this.initPromise;
    let preHeader: BlockHeader | undefined;
    for await (const { header, force, resolve } of this.headerQueue) {
      try {
        if (!force && preHeader !== undefined && !header.parentHash.equals(preHeader.hash())) {
          const ancestor = await this.findCommonAncestor(header, preHeader);
          await this.newHeader(ancestor.number, true, force);
        }
        await this.newHeader(header.number, false, force);
        preHeader = header;
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
   * @param reorg - If a reorg happened, invalidate all sections until that point
   * @param force - Force set section
   */
  private async newHeader(number: BN, reorg: boolean, force: boolean) {
    let confirmedSections: BN | undefined = number.gtn(this.confirmsBlockNumber) ? number.subn(this.confirmsBlockNumber).divn(this.sectionSize) : new BN(0);
    confirmedSections = confirmedSections.gtn(0) ? confirmedSections.subn(1) : undefined;

    // TODO: remove reorg logic
    if (reorg) {
      if (confirmedSections === undefined) {
        const batch = this.backend.prune(new BN(0));
        this.storedSections = undefined;
        await this.db.batch([...batch, DBDeleteBloomBitsSectionCount()]);
      } else if (this.storedSections === undefined || !confirmedSections.eq(this.storedSections)) {
        const batch = this.backend.prune(confirmedSections);
        this.storedSections = confirmedSections.clone();
        await this.db.batch([...batch, DBSaveBloomBitsSectionCount(this.storedSections)]);
      }
      return;
    }

    // force set current section
    if (confirmedSections !== undefined && force) {
      // save stored section count.
      await this.db.batch([DBSaveBloomBitsSectionCount(confirmedSections)]);
      this.storedSections = confirmedSections.clone();
      return;
    }

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
