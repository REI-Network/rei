import { rlp, toBuffer, unpadBuffer, bufferToInt } from 'ethereumjs-util';

export class Receipt {
  gasUsed: Buffer;
  bitvector: Buffer;
  logs: any[];
  status: 0 | 1;

  constructor(gasUsed: Buffer, bitvector: Buffer, logs: any[], status: 0 | 1) {
    this.gasUsed = gasUsed;
    this.bitvector = bitvector;
    this.logs = logs;
    this.status = status;
  }

  public static fromRlpSerializedReceipt(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized receipt input. Must be array');
    }
    return Receipt.fromValuesArray(values);
  }

  public static fromValuesArray(values: Buffer[]): Receipt {
    if (values.length !== 3) {
      throw new Error('Invalid receipt. Only expecting 3 values.');
    }
    const [gasUsed, bitvector, status] = values;
    return new Receipt(gasUsed, bitvector, [], bufferToInt(status) === 0 ? 0 : 1);
  }

  raw() {
    return [this.gasUsed, this.bitvector, unpadBuffer(toBuffer(this.status))];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
}
