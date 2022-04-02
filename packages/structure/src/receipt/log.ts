import { rlp, bufferToHex, bnToHex, intToHex } from 'ethereumjs-util';
import { LogExtension, ReceiptExtension } from './extension';

export type LogRawValue = Buffer | Buffer[];
export type LogRawValues = LogRawValue[];

/**
 * Transaction log class
 */
export class Log {
  address: Buffer;
  topics: Buffer[];
  data: Buffer;

  removed: boolean = false;
  extension?: LogExtension;

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
   * Init extension
   */
  initExtension(receipt: ReceiptExtension, logIndex: number) {
    this.extension = new LogExtension(receipt, logIndex);
  }

  /**
   * Convert log information to json format
   * @returns JSON format log
   */
  toRPCJSON() {
    return {
      address: bufferToHex(this.address),
      blockHash: this.extension?.blockHash ? bufferToHex(this.extension.blockHash) : undefined,
      blockNumber: this.extension?.blockNumber ? bnToHex(this.extension.blockNumber) : undefined,
      data: bufferToHex(this.data),
      logIndex: this.extension?.logIndex !== undefined ? intToHex(this.extension.logIndex) : undefined,
      removed: this.removed,
      topics: this.topics.map((topic) => bufferToHex(topic)),
      transactionHash: this.extension?.transactionHash ? bufferToHex(this.extension.transactionHash) : undefined,
      transactionIndex: this.extension?.transactionIndex !== undefined ? intToHex(this.extension.transactionIndex) : undefined
    };
  }
}
