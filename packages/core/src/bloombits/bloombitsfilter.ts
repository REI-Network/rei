import { Address, BN, keccak256 } from 'ethereumjs-util';
import { Block, Log } from '@gxchain2/structure';
import { createBNFunctionalMap, createBNFunctionalSet, decompressBytes } from '@gxchain2/utils';
import { Node } from '../node';
import { BloomBitsBlocks } from './index';

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

function topicMatched(normalizedTopics: Topics, logTopics: Buffer[]): boolean {
  for (let i = 0; i < normalizedTopics.length; i++) {
    if (normalizedTopics.length > logTopics.length) {
      return false;
    }

    const sub = normalizedTopics[i];
    if (sub === null || sub.length === 0) {
      continue;
    }

    let match: boolean = false;
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

export interface BloomBitsFilterOptions {
  node: Node;
  sectionSize: number;
}

export class BloomBitsFilter {
  private readonly node: Node;
  private readonly sectionSize: number;

  constructor(options: BloomBitsFilterOptions) {
    this.node = options.node;
    this.sectionSize = options.sectionSize;
  }

  static checkLogMatches(log: Log, { addresses, topics, from, to }: { addresses: Address[]; topics: Topics; from?: BN; to?: BN }): boolean {
    if (from && (!log.blockNumber || from.gt(log.blockNumber))) {
      return false;
    }
    if (to && (!log.blockNumber || to.lt(log.blockNumber))) {
      return false;
    }
    if (addresses.length > 0 && addresses.findIndex((addr) => addr.buf.equals(log.address)) === -1) {
      return false;
    }
    if (!topicMatched(topics, log.topics)) {
      return false;
    }
    return true;
  }

  private async checkBlockMatches(block: Block, addresses: Address[], topics: Topics) {
    const logs: Log[] = [];
    for (const tx of block.transactions) {
      const receipt = await this.node.db.getReceipt(tx.hash());
      for (const log of receipt.logs) {
        if (BloomBitsFilter.checkLogMatches(log, { addresses, topics })) {
          logs.push(log);
        }
      }
    }
    return logs;
  }

  async filterRange(from: BN, to: BN, addresses: Address[], topics: Topics) {
    let logs: Log[] = [];
    const append = (_logs: Log[]) => {
      logs = logs.concat(_logs);
      if (logs.length > 10000) {
        throw new Error('query returned more than 10000 results');
      }
    };
    const topicsBuf: Buffer[] = [];
    for (const subTopics of topics.filter((val) => val !== null) as (Buffer | (Buffer | null)[])[]) {
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

    const latestHeader = await this.node.blockchain.getLatestHeader();
    // if addresses and topics is empty, return all logs between from and to.
    if (blooms.length === 0) {
      for (const num = from.gt(latestHeader.number) ? latestHeader.number.clone() : from.clone(); num.lte(to) && num.lte(latestHeader.number); num.iaddn(1)) {
        append(await this.filterBlock(num, addresses, topics));
      }
      return logs;
    }

    let maxSection = await this.node.db.getStoredSectionCount();
    if (maxSection !== undefined) {
      // query indexed logs.
      let fromSection = from.divn(BloomBitsBlocks);
      let toSection = to.divn(BloomBitsBlocks);
      fromSection = fromSection.gt(maxSection) ? maxSection : fromSection;
      toSection = toSection.gt(maxSection) ? maxSection : toSection;
      for (const section = fromSection.clone(); section.lte(toSection); section.iaddn(1)) {
        // create a map to record checked block numbers.
        const checkedNums = createBNFunctionalSet();
        // create a map to cache the bit set of each bit.
        const bitsCache = new Map<number, Buffer>();
        // create a map to cache the header hash of each section.
        const headCache = createBNFunctionalMap<Buffer>();
        const getSenctionHash = async (section: BN) => {
          let hash = headCache.get(section);
          if (!hash) {
            hash = (await this.node.db.getCanonicalHeader(section.addn(1).muln(this.sectionSize).subn(1))).hash();
            headCache.set(section, hash);
          }
          return hash;
        };
        const getBits = async (bloom: number[], section: BN) => {
          const bitsArray: Buffer[] = [];
          for (const bit of bloom) {
            let bits = bitsCache.get(bit);
            if (!bits) {
              bits = (await this.node.db.getBloomBits(bit, section, await getSenctionHash(section))) as Buffer;
              bits = decompressBytes(bits, Math.floor(BloomBitsBlocks / 8));
              bitsCache.set(bit, bits);
            }
            bitsArray.push(bits);
          }
          return bitsArray.reduce((a, b) => {
            for (let i = 0; i < b.length; i++) {
              b[i] &= a[i];
            }
            return b;
          });
        };

        // the start block number of this section.
        const sectionStart = section.muln(this.sectionSize);
        // the end block number of this section.
        const sectionEnd = section.addn(1).muln(this.sectionSize);
        // calculate the start block number for check.
        const fromBlock = from.lt(sectionStart) ? sectionStart : from;
        // calculate the end block number for check.
        const toBlock = to.gt(sectionEnd) ? sectionEnd : to;
        for (const bloom of blooms) {
          // query the bits set of this bit of this section from database.
          const bits = await getBits(bloom, section);
          for (const num = fromBlock.clone(); num.lt(toBlock); num.iaddn(1)) {
            if (!checkedNums.has(num) && checkSingleNumber(bits, sectionStart, num)) {
              checkedNums.add(num.clone());
              append(await this.filterBlock(num, addresses, topics));
            }
          }
        }
      }
    }

    // query unindexed logs.
    const maxIndexedBlockNumber = maxSection ? maxSection.addn(1).muln(BloomBitsBlocks).subn(1) : new BN(0);
    for (const num = maxIndexedBlockNumber.addn(1); num.lte(to) && num.lte(latestHeader.number); num.iaddn(1)) {
      append(await this.filterBlock(num, addresses, topics));
    }
    return logs;
  }

  async filterBlock(blockHashOrNumber: Buffer | BN | number, addresses: Address[], topics: Topics) {
    const block = await this.node.db.getBlock(blockHashOrNumber);
    const logs = await this.checkBlockMatches(block, addresses, topics);
    logs.forEach((log) => (log.removed = false));
    return logs;
  }
}