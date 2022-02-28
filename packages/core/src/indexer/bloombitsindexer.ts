import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { DBSaveBloomBits, DBOp, Database } from '@rei-network/database';
import { BloomBitsGenerator, bloomBitLength, bloomBitsSectionSize } from '../bloomBits';
import { ChainIndexer } from './chainIndexer';
import { BloomBitsIndexerOptions, ChainIndexerBackend } from './types';

// confirm number
const confirmsBlockNumber = 256;

/**
 * BloomBitsIndexer implements ChainIndexerBackend, used to retrieve bloom
 */
export class BloomBitsIndexer implements ChainIndexerBackend {
  private readonly db: Database;
  private gen: BloomBitsGenerator;
  private section!: BN;
  private headerHash!: Buffer;

  /**
   * Create a bloomBitsIndexer by newing a ChainIndexer
   * @param options BloombitsIndexer options
   * @returns A ChainIndexer object
   */
  static createBloomBitsIndexer(options: BloomBitsIndexerOptions) {
    return new ChainIndexer({ ...options, confirmsBlockNumber, sectionSize: bloomBitsSectionSize, backend: new BloomBitsIndexer(options) });
  }

  constructor(options: BloomBitsIndexerOptions) {
    this.db = options.db;
    this.gen = new BloomBitsGenerator(bloomBitsSectionSize);
  }

  /**
   * Reset initiates the processing of a new chain segment,
   * potentially terminating any partially completed operations
   *  (in case of a reorg).
   * @param section The label of the regenerated section
   */
  reset(section: BN): void {
    this.section = section.clone();
    this.gen = new BloomBitsGenerator(bloomBitsSectionSize);
  }

  async prune(section: BN) {
    // await this.node.db.clearBloomBits(section);
  }

  /**
   * Process crunches through the next header in the chain segment. The caller
   * will ensure a sequential order of headers.
   * @param header BlockHeader
   */
  process(header: BlockHeader): void {
    this.gen.addBloom(header.number.sub(this.section.muln(bloomBitsSectionSize)).toNumber(), header.bloom);
    this.headerHash = header.hash();
  }

  /**
   * Commit finalizes the section metadata and stores it into the database.
   */
  async commit() {
    const batch: DBOp[] = [];
    for (let i = 0; i < bloomBitLength; i++) {
      const bits = this.gen.bitset(i);
      batch.push(DBSaveBloomBits(i, this.section, this.headerHash, Buffer.from(bits)));
    }
    await this.db.batch(batch);
  }
}
