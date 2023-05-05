import { bufferToInt, rlp, intToBuffer } from 'ethereumjs-util';
import { getRandomIntInclusive } from '@rei-network/utils';

const ELEM_MAX_INTEGER = Math.pow(2, 32) - 1;

export type BitArrayRaw = (Buffer | Buffer[])[];

export class BitArray {
  readonly length: number;
  private readonly elems: number[];

  static fromSerializedBitArray(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized bit array input. must be array');
    }
    return BitArray.fromValuesArray(values);
  }

  static fromValuesArray(values: BitArrayRaw) {
    if (values.length !== 2) {
      throw new Error('invalid values length');
    }

    const [length, elems] = values;
    if (!(length instanceof Buffer) || !Array.isArray(elems)) {
      throw new Error('invalid values');
    }
    return new BitArray(bufferToInt(length), elems.map(bufferToInt));
  }

  constructor(length: number, elems?: number[]) {
    this.length = length;
    this.elems = elems ?? new Array<number>(Math.ceil(length / 32)).fill(0);
  }

  getIndex(i: number): boolean {
    return (this.elems[Math.floor(i / 32)] & (1 << i % 32)) > 0;
  }

  setIndex(i: number, v: boolean): boolean {
    if (i >= this.length) {
      return false;
    }
    if (v) {
      this.elems[Math.floor(i / 32)] |= 1 << i % 32;
    } else {
      this.elems[Math.floor(i / 32)] &= ELEM_MAX_INTEGER - (1 << i % 32);
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

  pickRandom() {
    const trueIndices = this.getTrueIndices();
    if (trueIndices.length === 0) {
      return;
    }
    return trueIndices[getRandomIntInclusive(0, trueIndices.length - 1)];
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

  // Todo: fix this
  toBuffer() {
    const buffer = Buffer.from(new Uint8Array(this.elems.length * 4));
    for (let i = 0; i < this.elems.length; i++) {
      buffer.writeInt32LE(this.elems[i], i * 4);
    }
    return buffer;
  }

  raw(): BitArrayRaw {
    return [intToBuffer(this.length), [...this.elems.map(intToBuffer)]];
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
