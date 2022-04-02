import { BN } from 'ethereumjs-util';

// Geth compatible DB keys

const HEADS_KEY = 'heads';

/**
 * Current canonical head for light sync
 */
const HEAD_HEADER_KEY = 'LastHeader';

/**
 * Current canonical head for full sync
 */
const HEAD_BLOCK_KEY = 'LastBlock';

/**
 * Cique signers
 */
const CLIQUE_SIGNERS_KEY = 'CliqueSigners';

/**
 * Clique votes
 */
const CLIQUE_VOTES_KEY = 'CliqueVotes';

/**
 * Cique block signers (snapshot)
 */
const CLIQUE_BLOCK_SIGNERS_KEY = 'CliqueBlockSignersSnapshot';

/**
 * Bloom bits section count
 */
const BLOOM_BITS_SECTION_COUNT = 'scount';

/**
 * headerPrefix + number + hash -> header
 */
const HEADER_PREFIX = Buffer.from('h');

/**
 * headerPrefix + number + hash + tdSuffix -> td
 */
const TD_SUFFIX = Buffer.from('t');

/**
 * headerPrefix + number + numSuffix -> hash
 */
const NUM_SUFFIX = Buffer.from('n');

/**
 * blockHashPrefix + hash -> number
 */
const BLOCK_HASH_PEFIX = Buffer.from('H');

/**
 * bodyPrefix + number + hash -> block body
 */
const BODY_PREFIX = Buffer.from('b');

/**
 * receiptPrfix
 */
const RECEIPTS_PREFIX = Buffer.from('r');

/**
 * txLookupPrefix
 */
const TX_LOOKUP_PREFIX = Buffer.from('l');

/**
 * bloomBitsIndexPrefix
 */
const BLOOM_BITS_PREFIX = Buffer.from('B');

// Utility functions

/**
 * Convert BN to big endian Buffer
 */
const bufBE8 = (n: BN) => n.toArrayLike(Buffer, 'be', 8);

const tdKey = (n: BN, hash: Buffer) => Buffer.concat([HEADER_PREFIX, bufBE8(n), hash, TD_SUFFIX]);

const headerKey = (n: BN, hash: Buffer) => Buffer.concat([HEADER_PREFIX, bufBE8(n), hash]);

const bodyKey = (n: BN, hash: Buffer) => Buffer.concat([BODY_PREFIX, bufBE8(n), hash]);

const numberToHashKey = (n: BN) => Buffer.concat([HEADER_PREFIX, bufBE8(n), NUM_SUFFIX]);

const hashToNumberKey = (hash: Buffer) => Buffer.concat([BLOCK_HASH_PEFIX, hash]);

const receiptsKey = (n: BN, hash: Buffer) => Buffer.concat([RECEIPTS_PREFIX, bufBE8(n), hash]);

const txLookupKey = (hash: Buffer) => Buffer.concat([TX_LOOKUP_PREFIX, hash]);

const bloomBitsKey = (bit: number, section: BN, hash: Buffer) => {
  const buf = Buffer.alloc(10);
  buf.writeUInt16BE(bit);
  buf.writeBigUInt64BE(BigInt(section.toString()), 2);
  return Buffer.concat([BLOOM_BITS_PREFIX, buf, hash]);
};

/**
 * @hidden
 */
export { HEADS_KEY, HEAD_HEADER_KEY, HEAD_BLOCK_KEY, CLIQUE_SIGNERS_KEY, CLIQUE_VOTES_KEY, CLIQUE_BLOCK_SIGNERS_KEY, BLOOM_BITS_SECTION_COUNT, RECEIPTS_PREFIX, TX_LOOKUP_PREFIX, BLOOM_BITS_PREFIX, bufBE8, tdKey, headerKey, bodyKey, numberToHashKey, hashToNumberKey, receiptsKey, txLookupKey, bloomBitsKey };
