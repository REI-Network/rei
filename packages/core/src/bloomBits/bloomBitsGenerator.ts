import { BloomBitLength, BloomByteLength } from './index';

/**
 * Generator takes a number of bloom filters and generates the rotated bloom bits
 * to be used for batched filtering.
 */
export class BloomBitsGenerator {
  private sections: number;
  private nextSec: number;
  private blooms: number[][];

  constructor(sections: number) {
    if (sections % 8 !== 0) {
      throw new Error('section count not multiple of 8');
    }
    this.sections = sections;
    this.nextSec = 0;
    this.blooms = [];
    for (let i = 0; i < BloomBitLength; i++) {
      this.blooms.push(new Array<number>(Math.floor(sections / 8)).fill(0));
    }
  }

  /**
   * AddBloom takes a single bloom filter and sets the corresponding bit column
   * in memory accordingly.
   * @param index Position information
   * @param bloom Bloom filter to be added
   */
  addBloom(index: number, bloom: Buffer) {
    if (this.nextSec >= this.sections) {
      throw new Error('section out of bounds');
    }
    if (this.nextSec !== index) {
      throw new Error('nextSec not equal to index');
    }
    const byteIndex = Math.floor(this.nextSec / 8);
    const bitIndex = 7 - (this.nextSec % 8);
    for (let byt = 0; byt < BloomByteLength; byt++) {
      const bloomByte = bloom[byt];
      if (bloomByte === 0) {
        continue;
      }
      const base = 8 * byt;
      this.blooms[base + 7][byteIndex] |= ((bloomByte >> 7) & 1) << bitIndex;
      this.blooms[base + 6][byteIndex] |= ((bloomByte >> 6) & 1) << bitIndex;
      this.blooms[base + 5][byteIndex] |= ((bloomByte >> 5) & 1) << bitIndex;
      this.blooms[base + 4][byteIndex] |= ((bloomByte >> 4) & 1) << bitIndex;
      this.blooms[base + 3][byteIndex] |= ((bloomByte >> 3) & 1) << bitIndex;
      this.blooms[base + 2][byteIndex] |= ((bloomByte >> 2) & 1) << bitIndex;
      this.blooms[base + 1][byteIndex] |= ((bloomByte >> 1) & 1) << bitIndex;
      this.blooms[base][byteIndex] |= (bloomByte & 1) << bitIndex;
    }
    this.nextSec++;
  }

  /**
   * Bitset returns the bit vector belonging to the given bit index after all
   * blooms have been added.
   * @param index Position information
   * @returns A bit vector
   */
  bitset(index: number) {
    if (this.nextSec !== this.sections) {
      throw new Error('bloom not fully generated yet');
    }
    if (index >= BloomBitLength) {
      throw new Error('bloom bit out of bounds');
    }
    return this.blooms[index];
  }
}
