import { BN } from 'ethereumjs-util';
import { DBSaveBloomBits, DBOp, Database } from '@rei-network/database';
import { BloomBitsGenerator, bloomBitsConfig as config } from '../bloomBits';
import { ChainIndexer } from './chainIndexer';
import { BloomBitsIndexerOptions, ChainIndexerBackend } from './types';
import { EMPTY_HASH } from '../utils';

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
    return new ChainIndexer({ ...options, confirmsBlockNumber: config.confirmsBlockNumber, sectionSize: config.bloomBitsSectionSize, backend: new BloomBitsIndexer(options) });
  }

  constructor(options: BloomBitsIndexerOptions) {
    this.db = options.db;
    this.gen = new BloomBitsGenerator();
  }

  /**
   * Reset initiates the processing of a new chain segment,
   * potentially terminating any partially completed operations
   *  (in case of a reorg).
   * @param section The label of the regenerated section
   */
  reset(section: BN): void {
    this.section = section.clone();
    this.gen = new BloomBitsGenerator();
  }

  prune(section: BN) {
    return [];
  }

  /**
   * Process crunches through the next header in the chain segment. The caller
   * will ensure a sequential order of headers.
   * @param header BlockHeader
   */
  // process(header: BlockHeader): void {
  //   this.gen.addBloom(header.number.sub(this.section.muln(config.bloomBitsSectionSize)).toNumber(), header.bloom);
  //   this.headerHash = header.hash();
  // }

  // TODO
  process(number: BN, bloom: Buffer, hash: Buffer) {
    this.gen.addBloom(number.sub(this.section.muln(config.bloomBitsSectionSize)).toNumber(), bloom);
    this.headerHash = hash;
  }

  /**
   * Commit finalizes the section metadata and stores it into the database.
   */
  commit() {
    // check header hash
    if (this.headerHash.equals(EMPTY_HASH)) {
      throw new Error('invalid header hash');
    }

    const batch: DBOp[] = [];
    for (let i = 0; i < config.bloomBitLength; i++) {
      const bits = this.gen.bitset(i);
      batch.push(DBSaveBloomBits(i, this.section, this.headerHash, Buffer.from(bits)));
    }
    return batch;
  }
}
