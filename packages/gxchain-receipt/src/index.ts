import { rlp, toBuffer, unpadBuffer, bufferToInt, BN, bufferToHex, bnToHex, intToHex } from 'ethereumjs-util';

export type ReceiptRawValue = (Buffer | LogRawValues[])[];

export class Receipt {
  gasUsed: Buffer;
  bitvector: Buffer;
  logs: Log[];
  status: 0 | 1;

  blockHash?: Buffer;
  blockNumber?: BN;
  contractAddress?: Buffer;
  cumulativeGasUsed?: BN;
  from?: Buffer;
  to?: Buffer;
  transactionHash?: Buffer;
  transactionIndex?: number;

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
    const [status, gasUsed, bitvector, rawLogs] = values as [Buffer, Buffer, Buffer, LogRawValues[]];
    return new Receipt(
      gasUsed,
      bitvector,
      rawLogs.map((rawLog) => Log.fromValuesArray(rawLog)),
      bufferToInt(status) === 0 ? 0 : 1
    );
  }

  raw(): ReceiptRawValue {
    return [unpadBuffer(toBuffer(this.status)), this.gasUsed, this.bitvector, this.logs.map((l) => l.raw())];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  toJSON() {
    return {
      blockHash: this.blockHash ? bufferToHex(this.blockHash) : undefined,
      blockNumber: this.blockNumber ? bnToHex(this.blockNumber) : undefined,
      contractAddress: this.contractAddress ? bufferToHex(this.contractAddress) : null,
      cumulativeGasUsed: this.cumulativeGasUsed ? bnToHex(this.cumulativeGasUsed) : undefined,
      from: this.from ? bufferToHex(this.from) : undefined,
      gasUsed: bufferToHex(this.gasUsed),
      logs: this.logs.map((log) => log.toJSON()),
      logsBloom: bufferToHex(this.bitvector),
      status: intToHex(this.status),
      to: this.to ? bufferToHex(this.to) : undefined,
      transactionHash: this.transactionHash ? bufferToHex(this.transactionHash) : undefined,
      transactionIndex: this.transactionIndex !== undefined ? intToHex(this.transactionIndex) : undefined
    };
  }
}

export type LogRawValue = Buffer | Buffer[];
export type LogRawValues = LogRawValue[];

export class Log {
  address: Buffer;
  topics: Buffer[];
  data: Buffer;

  blockHash?: Buffer;
  blockNumber?: BN;
  logIndex?: number;
  removed?: boolean;
  transactionHash?: Buffer;
  transactionIndex?: number;

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

  toJSON() {
    return {
      address: bufferToHex(this.address),
      blockHash: this.blockHash ? bufferToHex(this.blockHash) : undefined,
      blockNumber: this.blockNumber ? bnToHex(this.blockNumber) : undefined,
      data: bufferToHex(this.data),
      logIndex: this.logIndex !== undefined ? intToHex(this.logIndex) : undefined,
      removed: this.removed,
      topics: this.topics.map((topic) => bufferToHex(topic)),
      transactionHash: this.transactionHash ? bufferToHex(this.transactionHash) : undefined,
      transactionIndex: this.transactionIndex !== undefined ? intToHex(this.transactionIndex) : undefined
    };
  }
}
