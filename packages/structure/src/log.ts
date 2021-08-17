import { rlp, BN, bufferToHex, bnToHex, intToHex } from 'ethereumjs-util';
import { Receipt } from './receipt';

export type LogRawValue = Buffer | Buffer[];
export type LogRawValues = LogRawValue[];

/**
 * Transaction log class
 */
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

  /**
   * Generate Log object by given serialized data
   * @param serialized - Serialized data
   * @returns Log object
   */
  public static fromRlpSerializedLog(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized log input. Must be array');
    }
    return Log.fromValuesArray(values);
  }

  /**
   * Generate Log object by given values
   * @param values - Values
   * @returns Log object
   */
  public static fromValuesArray(values: LogRawValues): Log {
    if (values.length !== 3) {
      throw new Error('Invalid log. Only expecting 3 values.');
    }
    const [address, topics, data] = values as [Buffer, Buffer[], Buffer];
    return new Log(address, topics, data);
  }

  /**
   * Get the row data in the log information
   * @returns The object of address topics and data
   */
  raw(): LogRawValues {
    return [this.address, this.topics, this.data];
  }

  /**
   * Serialize transaction log information
   * @returns Encoded data
   */
  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  /**
   * Add additional information from receipt
   * @param receipt - Transaction receipt
   * @param logIndex - Log index
   */
  installProperties(receipt: Receipt, logIndex: number) {
    this.blockHash = receipt.blockHash;
    this.blockNumber = receipt.blockNumber;
    this.transactionHash = receipt.transactionHash;
    this.transactionIndex = receipt.transactionIndex;
    this.logIndex = logIndex;
  }

  /**
   * Convert log information to json format
   * @returns JSON format log
   */
  toRPCJSON() {
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
