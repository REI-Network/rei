import { rlp } from 'ethereumjs-util';
import { getRandomIntInclusive } from '@gxchain2/utils';

const ELEM_MAX_INTEGER = Math.pow(2, 32) - 1;

export class BitArray {
  readonly length: number;
  private readonly elems: number[];

  static fromSerializedBitArray(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized bit array input. must be array');
    }
    return BitArray.fromValuesArray(values as any);
  }

  static fromValuesArray(values: [number, number[]]) {
    if (values.length !== 2) {
      throw new Error('invalid values length');
    }
    const [length, elems] = values;
    return new BitArray(length, elems);
  }

  constructor(length: number, elems?: number[]) {
    this.length = length;
    this.elems = elems ?? new Array<number>(Math.ceil(length / 32));
  }

  setIndex(i: number, v: boolean): boolean {
    if (i >= this.length) {
      return false;
    }
    if (v) {
      this.elems[Math.floor(length / 32)] |= 1 << i % 32;
    } else {
      this.elems[Math.floor(length / 32)] &= ELEM_MAX_INTEGER - (1 << i % 32);
    }
    return true;
  }

  copy() {
    return new BitArray(this.length, [...this.elems]);
  }

  sub(other: BitArray) {
    const result = this.copy();
    const length = Math.min(this.length, other.length);
    for (let i = 0; i < length; i++) {
      result.elems[i] &= ELEM_MAX_INTEGER - other.elems[i];
    }
    return result;
  }

  pickRandom(): [number, boolean] {
    const trueIndices = this.getTrueIndices();
    if (trueIndices.length === 0) {
      return [0, false];
    }
    return [trueIndices[getRandomIntInclusive(0, trueIndices.length - 1)], true];
  }

  getTrueIndices() {
    const trueIndices: number[] = [];
    let curBit = 0;
    for (let i = 0; i < this.elems.length - 1; i++) {
      const elem = this.elems[i];
      if (elem === 0) {
        curBit += 32;
        continue;
      }
      for (let j = 0; j < 32; j++) {
        if ((elem & (1 << j)) > 0) {
          trueIndices.push(curBit);
        }
        curBit++;
      }
    }
    const lastElem = this.elems[this.elems.length - 1];
    const numFinalBits = this.length - curBit;
    for (let i = 0; i < numFinalBits; i++) {
      if ((lastElem & (1 << i)) > 0) {
        trueIndices.push(curBit);
      }
      curBit++;
    }
    return trueIndices;
  }

  toBuffer() {
    const buffer = Buffer.from(new Uint8Array(Math.ceil(this.length / 8)));
    for (let i = 0; i < this.elems.length; i++) {
      buffer.writeInt32LE(this.elems[i], i * 4);
    }
    return buffer;
  }

  raw() {
    return [this.length, [...this.elems]];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  update(other: BitArray) {
    if (this.length !== other.length) {
      throw new Error('invalid update length');
    }

    for (let i = 0; i < this.elems.length; i++) {
      this.elems[i] = other.elems[i];
    }
  }
}
