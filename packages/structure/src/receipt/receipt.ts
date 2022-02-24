import { rlp, toBuffer, unpadBuffer, bufferToInt, BN, bufferToHex, bnToHex, intToHex, generateAddress } from 'ethereumjs-util';
import { Block } from '../block';
import { Transaction } from '../tx';
import { LogRawValues, Log } from './log';
import { ReceiptExtension } from './extension';

export type ReceiptRawValue = (Buffer | LogRawValues[])[];

/**
 * Transaction receipt class
 */
export class Receipt {
  cumulativeGasUsed: Buffer;
  bitvector: Buffer;
  logs: Log[];
  status: 0 | 1;

  extension?: ReceiptExtension;

  /**
   * Return the cumulative gas in `BN` type
   */
  get bnCumulativeGasUsed() {
    return new BN(this.cumulativeGasUsed);
  }

  constructor(cumulativeGasUsed: Buffer, bitvector: Buffer, logs: Log[], status: 0 | 1) {
    this.cumulativeGasUsed = cumulativeGasUsed;
    this.bitvector = bitvector;
    this.logs = logs;
    this.status = status;
  }

  /**
   * Generate receipt object by given serialized data
   * @param serialized - Serialized data
   * @returns Receipt object
   */
  public static fromRlpSerializedReceipt(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized receipt input. Must be array');
    }
    return Receipt.fromValuesArray(values);
  }

  /**
   * Generate receipt object by given values
   * @param values - Values
   * @returns Receipt object
   */
  public static fromValuesArray(values: ReceiptRawValue): Receipt {
    if (values.length !== 4) {
      throw new Error('Invalid receipt. Only expecting 4 values.');
    }
    const [status, cumulativeGasUsed, bitvector, rawLogs] = values as [Buffer, Buffer, Buffer, LogRawValues[]];
    return new Receipt(
      cumulativeGasUsed,
      bitvector,
      rawLogs.map((rawLog) => Log.fromValuesArray(rawLog)),
      bufferToInt(status) === 0 ? 0 : 1
    );
  }

  /**
   * Get the row data from receipt
   * @returns
   */
  raw(): ReceiptRawValue {
    return [unpadBuffer(toBuffer(this.status)), this.cumulativeGasUsed, this.bitvector, this.logs.map((l) => l.raw())];
  }

  /**
   * Serialize data
   * @returns Encoded data
   */
  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  /**
   * Init extension
   */
  initExtension(block: Block, tx: Transaction, gasUsed: BN, txIndex: number) {
    this.extension = new ReceiptExtension(block, tx, gasUsed, txIndex);
    this.logs.forEach((log, i) => {
      log.initExtension(this.extension!, i);
    });
  }

  /**
   * Convert receipt information to json format
   * @returns JSON format receipt
   */
  toRPCJSON() {
    return {
      blockHash: this.extension?.blockHash ? bufferToHex(this.extension.blockHash) : undefined,
      blockNumber: this.extension?.blockNumber ? bnToHex(this.extension.blockNumber) : undefined,
      contractAddress: this.extension?.contractAddress ? bufferToHex(this.extension.contractAddress) : null,
      cumulativeGasUsed: bnToHex(this.bnCumulativeGasUsed),
      from: this.extension?.from ? bufferToHex(this.extension.from) : undefined,
      gasUsed: this.extension?.gasUsed ? bnToHex(this.extension.gasUsed) : undefined,
      logs: this.logs.map((log) => log.toRPCJSON()),
      logsBloom: bufferToHex(this.bitvector),
      status: intToHex(this.status),
      to: this.extension?.to ? bufferToHex(this.extension.to) : undefined,
      transactionHash: this.extension?.transactionHash ? bufferToHex(this.extension.transactionHash) : undefined,
      transactionIndex: this.extension?.transactionIndex !== undefined ? intToHex(this.extension.transactionIndex) : undefined
    };
  }
}
