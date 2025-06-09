import { Address, BN, keccak256 } from 'ethereumjs-util';
import { Log, Receipt, Block } from '@rei-network/structure';
import { FunctionalBNMap, FunctionalBNSet } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { EMPTY_HASH } from '../utils';
import { ReceiptsCache } from './receiptsCache';
import { bloomBitsConfig as config } from './config';

/**
 * calcBloomIndexes returns the bloom filter bit indexes belonging to the given key
 * @param data - Data message, type must be Buffer
 * @returns Calculated result
 */
export function calcBloomIndexes(data: Buffer) {
  data = keccak256(data);
  const mask = 2047; // binary 11111111111

  const idxs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const first2bytes = data.readUInt16BE(i * 2);
    const loc = mask & first2bytes;
    const byteLoc = loc >> 3;
    idxs.push((256 - byteLoc - 1) * 8 + (loc % 8));
  }
  return idxs;
}

export type Topics = (Buffer | null | (Buffer | null)[])[];

/**
 * Checks if multiple topics are in the logtopics
 * @param normalizedTopics The multiple topics to be checked
 * @param logTopics
 * @returns `true` if every topic is in the log
 */
function topicMatched(normalizedTopics: Topics, logTopics: Buffer[]): boolean {
  for (let i = 0; i < normalizedTopics.length; i++) {
    if (normalizedTopics.length > logTopics.length) {
      return false;
    }

    const sub = normalizedTopics[i];
    if (sub === null || sub.length === 0) {
      continue;
    }

    let match = false;
    if (sub instanceof Buffer) {
      match = logTopics[i].equals(sub);
    } else {
      for (const topic of sub) {
        if (topic === null || logTopics[i].equals(topic)) {
          match = true;
          break;
        }
      }
    }
    if (!match) {
      return false;
    }
  }

  return true;
}

/**
 * Check the single bit in the given position of bits is one or zero
 * @param bits Target data
 * @param sectionStart The section start index number
 * @param num The index of bit be checked
 * @returns `true` if the bit is `1`, `false` if the bit is `0`
 */
function checkSingleNumber(bits: Buffer, sectionStart: BN, num: BN) {
  const numOfSection = num.sub(sectionStart).toNumber();
  const byte = bits[Math.floor(numOfSection / 8)];
  if (byte !== 0) {
    const offset = 7 - (numOfSection % 8);
    if (byte & (1 << offset)) {
      return true;
    }
  }
  return false;
}

export interface BloomBitsFilterBackend {
  db: Database;
  receiptsCache: ReceiptsCache;
  latestBlock: Block;
}

/**
 * Represents a Bloom filter.
 */
export class BloomBitsFilter {
  private readonly backend: BloomBitsFilterBackend;

  constructor(backend: BloomBitsFilterBackend) {
    this.backend = backend;
  }

  /**
   * Check if log is mactched in the given range
   * @param log The log to be checked
   * @param param1 Range parameter, inlcude address, topics, start block number, endb block number
   * @returns `true` if matched
   */
  static checkLogMatches(
    log: Log,
    {
      addresses,
      topics,
      from,
      to
    }: { addresses: Address[]; topics: Topics; from?: BN; to?: BN }
  ): boolean {
    if (
      from &&
      (!log.extension!.blockNumber || from.gt(log.extension!.blockNumber))
    ) {
      return false;
    }
    if (
      to &&
      (!log.extension!.blockNumber || to.lt(log.extension!.blockNumber))
    ) {
      return false;
    }
    if (
      addresses.length > 0 &&
      addresses.findIndex((addr) => addr.buf.equals(log.address)) === -1
    ) {
      return false;
    }
    if (!topicMatched(topics, log.topics)) {
      return false;
    }
    return true;
  }

  /**
   * Find logs which are matched by given range in this block
   * @param receipts Receipts
   * @param addresses Given address range
   * @param topics Given topics range
   * @returns The logs meet the conditions
   */
  private async checkBlockMatches(
    receipts: Receipt[],
    addresses: Address[],
    topics: Topics
  ) {
    const logs: Log[] = [];
    for (const receipt of receipts) {
      for (const log of receipt.logs) {
        if (BloomBitsFilter.checkLogMatches(log, { addresses, topics })) {
          logs.push(log);
        }
      }
    }
    return logs;
  }

  /**
   * Returns an array of all logs matching filter with given range
   * @param from Number of block at beginning of range
   * @param to The end block number
   * @param addresses Addresses which meet the requirements
   * @param topics Topics which meet the requirements
   * @returns All logs that meet the conditions
   */
  async filterRange(from: BN, to: BN, addresses: Address[], topics: Topics) {
    let logs: Log[] = [];
    const append = (_logs: Log[]) => {
      logs = logs.concat(_logs);
      if (logs.length > 10000) {
        throw new Error('query returned more than 10000 results');
      }
    };
    const topicsBuf: Buffer[] = [];
    for (const subTopics of topics.filter((val) => val !== null) as (
      | Buffer
      | (Buffer | null)[]
    )[]) {
      if (subTopics instanceof Buffer) {
        topicsBuf.push(subTopics);
      } else {
        for (const topicBuf of subTopics) {
          if (topicBuf !== null) {
            topicsBuf.push(topicBuf);
          }
        }
      }
    }
    const blooms: number[][] = [];
    for (const buf of addresses.map((addr) => addr.buf).concat(topicsBuf)) {
      blooms.push(calcBloomIndexes(buf));
    }

    const latestHeader = this.backend.latestBlock.header;
    if (from.gt(latestHeader.number)) {
      return logs;
    }

    // if addresses and topics is empty, return all logs between from and to.
    if (blooms.length === 0) {
      for (
        const num = from.clone();
        num.lte(to) && num.lte(latestHeader.number);
        num.iaddn(1)
      ) {
        append(await this.filterBlock(num, addresses, topics));
      }
      return logs;
    }

    let maxSection = await this.backend.db.getStoredSectionCount();
    if (maxSection !== undefined) {
      // query indexed logs.
      let fromSection = from.divn(config.bloomBitsSectionSize);
      let toSection = to.divn(config.bloomBitsSectionSize);
      fromSection = fromSection.gt(maxSection) ? maxSection : fromSection;
      toSection = toSection.gt(maxSection) ? maxSection : toSection;
      for (
        const section = fromSection.clone();
        section.lte(toSection);
        section.iaddn(1)
      ) {
        // create a map to record checked block numbers.
        const checkedNums = new FunctionalBNSet();
        // create a map to cache the bit set of each bit.
        const bitsCache = new Map<number, Buffer>();
        // create a map to cache the header hash of each section.
        const headCache = new FunctionalBNMap<Buffer>();
        const getSenctionHash = async (section: BN) => {
          let hash = headCache.get(section);
          if (!hash) {
            try {
              hash = await this.backend.db.numberToHash(
                section.addn(1).muln(config.bloomBitsSectionSize).subn(1)
              );
            } catch (err) {
              // ignore error
              // we may lose some blocks due to snapshot synchronization
              hash = EMPTY_HASH;
            }
            headCache.set(section, hash);
          }
          return hash;
        };
        const getBits = async (bloom: number[], section: BN) => {
          const bitsArray: Buffer[] = [];
          for (const bit of bloom) {
            let bits = bitsCache.get(bit);
            if (!bits) {
              bits = await this.backend.db.getBloomBits(
                bit,
                section,
                await getSenctionHash(section),
                Math.floor(config.bloomBitsSectionSize / 8)
              );
              bitsCache.set(bit, bits);
            }
            bitsArray.push(bits);
          }
          return bitsArray.reduce((a, b) => {
            const _b = Buffer.from(b);
            for (let i = 0; i < b.length; i++) {
              _b[i] &= a[i];
            }
            return _b;
          });
        };

        // the start block number of this section.
        const sectionStart = section.muln(config.bloomBitsSectionSize);
        // the end block number of this section.
        const sectionEnd = section.addn(1).muln(config.bloomBitsSectionSize);
        // calculate the start block number for check.
        const fromBlock = from.lt(sectionStart) ? sectionStart : from;
        // calculate the end block number for check.
        const toBlock = to.gt(sectionEnd) ? sectionEnd : to;
        for (const bloom of blooms) {
          // query the bits set of this bit of this section from database.
          const bits = await getBits(bloom, section);
          for (const num = fromBlock.clone(); num.lte(toBlock); num.iaddn(1)) {
            if (
              !checkedNums.has(num) &&
              checkSingleNumber(bits, sectionStart, num)
            ) {
              checkedNums.add(num.clone());
              append(await this.filterBlock(num, addresses, topics));
            }
          }
        }
      }
    }

    // query unindexed logs.
    const maxIndexedBlockNumber = maxSection
      ? maxSection.addn(1).muln(config.bloomBitsSectionSize).subn(1)
      : new BN(0);
    let startAt = maxIndexedBlockNumber.addn(1);
    for (
      const num = from.gt(startAt) ? from.clone() : startAt;
      num.lte(to) && num.lte(latestHeader.number);
      num.iaddn(1)
    ) {
      append(await this.filterBlock(num, addresses, topics));
    }
    return logs;
  }

  /**
   * Get the qualified logs in a block
   * @param blockHashOrNumber The block to be filtered
   * @param addresses Addresses which meet the requirements
   * @param topics Topics which meet the requirements
   * @returns All logs that meet the conditions
   */
  async filterBlock(
    blockHashOrNumber: Buffer | BN | number,
    addresses: Address[],
    topics: Topics
  ) {
    let logs: Log[] = [];
    try {
      const receipts = await this.backend.receiptsCache.get(
        blockHashOrNumber,
        this.backend.db
      );
      logs = await this.checkBlockMatches(receipts, addresses, topics);
      logs.forEach((log) => (log.removed = false));
    } catch (err) {
      // ignore error...
      // we may lose some blocks due to snapshot synchronization
    }
    return logs;
  }
}
