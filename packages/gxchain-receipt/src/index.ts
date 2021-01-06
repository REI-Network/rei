import { rlp, toBuffer, unpadBuffer, bufferToInt } from 'ethereumjs-util';

export type ReceiptRawValue = (Buffer | LogRawValues[])[];

export class Receipt {
  gasUsed: Buffer;
  bitvector: Buffer;
  logs: Log[];
  status: 0 | 1;

  constructor(gasUsed: Buffer, bitvector: Buffer, logs: Log[], status: 0 | 1) {
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

  public static fromValuesArray(values: ReceiptRawValue): Receipt {
    if (values.length !== 4) {
      throw new Error('Invalid receipt. Only expecting 4 values.');
    }
    const [gasUsed, bitvector, rawLogs, status] = values as [Buffer, Buffer, LogRawValues[], Buffer];
    return new Receipt(
      gasUsed,
      bitvector,
      rawLogs.map((rawLog) => Log.fromValuesArray(rawLog)),
      bufferToInt(status) === 0 ? 0 : 1
    );
  }

  raw(): ReceiptRawValue {
    return [this.gasUsed, this.bitvector, this.logs.map((l) => l.raw()), unpadBuffer(toBuffer(this.status))];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
}

export type LogRawValue = Buffer | Buffer[];
export type LogRawValues = LogRawValue[];

export class Log {
  address: Buffer;
  topics: Buffer[];
  data: Buffer;

  constructor(address: Buffer, topics: Buffer[], data: Buffer) {
    this.address = address;
    this.topics = topics;
    this.data = data;
  }

  public static fromRlpSerializedLog(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized log input. Must be array');
    }
    return Receipt.fromValuesArray(values);
  }

  public static fromValuesArray(values: LogRawValues): Log {
    if (values.length !== 3) {
      throw new Error('Invalid log. Only expecting 3 values.');
    }
    const [address, topics, data] = values as [Buffer, Buffer[], Buffer];
    return new Log(address, topics, data);
  }

  raw(): LogRawValues {
    return [this.address, this.topics, this.data];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
}
