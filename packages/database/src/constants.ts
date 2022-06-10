import { BN } from 'ethereumjs-util';

// Geth compatible DB keys

export const HEADS_KEY = 'heads';

/**
 * Current canonical head for light sync
 */
export const HEAD_HEADER_KEY = 'LastHeader';

/**
 * Current canonical head for full sync
 */
export const HEAD_BLOCK_KEY = 'LastBlock';

/**
 * Cique signers
 */
export const CLIQUE_SIGNERS_KEY = 'CliqueSigners';

/**
 * Clique votes
 */
export const CLIQUE_VOTES_KEY = 'CliqueVotes';

/**
 * Cique block signers (snapshot)
 */
export const CLIQUE_BLOCK_SIGNERS_KEY = 'CliqueBlockSignersSnapshot';

/**
 * Bloom bits section count
 */
export const BLOOM_BITS_SECTION_COUNT = 'scount';

/**
 * headerPrefix + number + hash -> header
 */
export const HEADER_PREFIX = Buffer.from('h');

/**
 * headerPrefix + number + hash + tdSuffix -> td
 */
export const TD_SUFFIX = Buffer.from('t');

/**
 * headerPrefix + number + numSuffix -> hash
 */
export const NUM_SUFFIX = Buffer.from('n');

/**
 * blockHashPrefix + hash -> number
 */
export const BLOCK_HASH_PEFIX = Buffer.from('H');

/**
 * bodyPrefix + number + hash -> block body
 */
export const BODY_PREFIX = Buffer.from('b');

/**
 * receiptPrfix
 */
export const RECEIPTS_PREFIX = Buffer.from('r');

/**
 * txLookupPrefix
 */
export const TX_LOOKUP_PREFIX = Buffer.from('l');

/**
 * bloomBitsIndexPrefix
 */
export const BLOOM_BITS_PREFIX = Buffer.from('B');

/**
 * snapshotAccountPrefix
 */
export const SNAP_ACCOUNT_PREFIX = Buffer.from('a');

/**
 * snapshotStoragePrefix
 */
export const SNAP_STORAGE_PREFIX = Buffer.from('o');

/**
 * snapshotRootKey
 */
export const SNAP_ROOT_KEY = Buffer.from('SnapshotRoot');

/**
 * snapshotJournalKey
 */
export const SNAP_JOURNAL_KEY = Buffer.from('SnapshotJournal');

/**
 * snapshotGeneratorKey
 */
export const SNAP_GENERATOR_KEY = Buffer.from('SnapshotGenerator');

/**
 * snapshotRecoveryKey
 */
export const SNAP_RECOVERY_KEY = Buffer.from('SnapshotRecovery');

/**
 * snapshotDisableKey
 */
export const SNAP_DISABLED_KEY = Buffer.from('SnapshotDisabled');

/**
 *  snapshotSyncProgress
 */
export const SNAP_SYNC_PROGRESS_KEY = Buffer.from('SnapshotSyncProgress');

// Utility functions

/**
 * Convert BN to big endian Buffer
 */
export const bufBE8 = (n: BN) => n.toArrayLike(Buffer, 'be', 8);

export const tdKey = (n: BN, hash: Buffer) => Buffer.concat([HEADER_PREFIX, bufBE8(n), hash, TD_SUFFIX]);

export const headerKey = (n: BN, hash: Buffer) => Buffer.concat([HEADER_PREFIX, bufBE8(n), hash]);

export const bodyKey = (n: BN, hash: Buffer) => Buffer.concat([BODY_PREFIX, bufBE8(n), hash]);

export const numberToHashKey = (n: BN) => Buffer.concat([HEADER_PREFIX, bufBE8(n), NUM_SUFFIX]);

export const hashToNumberKey = (hash: Buffer) => Buffer.concat([BLOCK_HASH_PEFIX, hash]);

export const receiptsKey = (n: BN, hash: Buffer) => Buffer.concat([RECEIPTS_PREFIX, bufBE8(n), hash]);

export const txLookupKey = (hash: Buffer) => Buffer.concat([TX_LOOKUP_PREFIX, hash]);

export const bloomBitsKey = (bit: number, section: BN, hash: Buffer) => {
  const buf = Buffer.alloc(10);
  buf.writeUInt16BE(bit);
  buf.writeBigUInt64BE(BigInt(section.toString()), 2);
  return Buffer.concat([BLOOM_BITS_PREFIX, buf, hash]);
};

export const snapAccountKey = (accHash: Buffer) => Buffer.concat([SNAP_ACCOUNT_PREFIX, accHash]);

export const snapStorageKey = (accHash: Buffer, storageHash: Buffer) => Buffer.concat([SNAP_STORAGE_PREFIX, accHash, storageHash]);
