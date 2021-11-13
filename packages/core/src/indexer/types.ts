import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@gxchain2/structure';
import { Database } from '@gxchain2/database';

/**
 * ChainIndexerBackend defines the methods needed to process chain segments in
 * the background and write the segment results into the database. These can be
 * used to create filter blooms.
 */
export interface ChainIndexerBackend {
  /**
   * Reset initiates the processing of a new chain segment, potentially terminating
   * any partially completed operations (in case of a reorg).
   * @param section The label of the regenerated section
   */
  reset(section: BN): void;

  /**
   * Process crunches through the next header in the chain segment. The caller
   * will ensure a sequential order of headers.
   * @param header
   */
  process(header: BlockHeader): void;

  /**
   * Commit finalizes the section metadata and stores it into the database.
   */
  commit(): Promise<void>;

  /**
   * Prune deletes the chain index older than the given threshold.
   * @param section Larger than the section will be deleted
   */
  prune(section: BN): Promise<void>;
}

export interface ChainIndexerOptions {
  db: Database;
  sectionSize: number;
  confirmsBlockNumber: number;
  backend: ChainIndexerBackend;
}

export interface BloomBitsIndexerOptions extends Omit<ChainIndexerOptions, 'backend'> {}
