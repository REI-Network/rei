import { BlockHeader } from '@ethereumjs/block';
import { BN } from 'ethereumjs-util';
import { DBSaveBloomBits, DBOp } from '@gxchain2/database';
import { ChainIndexer, ChainIndexerBackend, ChainIndexerOptions } from './chainindexer';
import { BloomBitsGenerator } from '../bloombits';
import { Node } from '../node';

export interface BloomBitsIndexerOptions extends ChainIndexerOptions {}

export class BloomBitsIndexer implements ChainIndexerBackend {
  private readonly sectionSize: number;
  private readonly node: Node;
  private gen: BloomBitsGenerator;
  private section!: BN;
  private headerHash!: Buffer;

  static createBloomBitsIndexer(options) {
    return new ChainIndexer(Object.assign(options, { backend: new BloomBitsIndexer(options) }));
  }

  constructor(options: BloomBitsIndexerOptions) {
    this.node = options.node;
    this.sectionSize = options.sectionSize;
    this.gen = new BloomBitsGenerator(options.sectionSize);
  }

  reset(section: BN): void {
    this.section = section.clone();
    this.gen = new BloomBitsGenerator(this.sectionSize);
  }

  async prune(section: BN) {
    await this.node.db.clearBloomBits(section);
  }

  process(header: BlockHeader): void {
    this.gen.addBloom(header.number.sub(this.section.muln(this.sectionSize)).toNumber(), header.bloom);
    this.headerHash = header.hash();
  }

  async commit() {
    const batch: DBOp[] = [];
    for (let i = 0; i < 2048; i++) {
      const bits = this.gen.bitset(i);
      batch.push(DBSaveBloomBits(i, this.section, this.headerHash, Buffer.from(bits)));
    }
    await this.node.db.batch(batch);
  }
}
