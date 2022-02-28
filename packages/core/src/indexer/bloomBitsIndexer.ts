import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { DBSaveBloomBits, DBOp, Database } from '@rei-network/database';
import { BloomBitsGenerator } from '../bloomBits';
import { BloomBitLength } from '../bloomBits';
import { ChainIndexer } from './chainIndexer';
import { BloomBitsIndexerOptions, ChainIndexerBackend } from './types';

/**
 * BloomBitsIndexer implements ChainIndexerBackend, used to retrieve bloom
 */
export class BloomBitsIndexer implements ChainIndexerBackend {
  private readonly sectionSize: number;
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
    return new ChainIndexer(Object.assign(options, { backend: new BloomBitsIndexer(options) }));
  }

  constructor(options: BloomBitsIndexerOptions) {
    this.db = options.db;
    this.sectionSize = options.sectionSize;
    this.gen = new BloomBitsGenerator(options.sectionSize);
  }

  /**
   * Reset initiates the processing of a new chain segment,
   * potentially terminating any partially completed operations
   *  (in case of a reorg).
   * @param section The label of the regenerated section
   */
  reset(section: BN): void {
    this.section = section.clone();
    this.gen = new BloomBitsGenerator(this.sectionSize);
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
    this.gen.addBloom(header.number.sub(this.section.muln(this.sectionSize)).toNumber(), header.bloom);
    this.headerHash = header.hash();
  }

  /**
   * Commit finalizes the section metadata and stores it into the database.
   */
  async commit() {
    const batch: DBOp[] = [];
    for (let i = 0; i < BloomBitLength; i++) {
      const bits = this.gen.bitset(i);
      batch.push(DBSaveBloomBits(i, this.section, this.headerHash, Buffer.from(bits)));
    }
    await this.db.batch(batch);
  }
}
