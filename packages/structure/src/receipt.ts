import { rlp, toBuffer, unpadBuffer, bufferToInt, BN, bufferToHex, bnToHex, intToHex, generateAddress } from 'ethereumjs-util';
import { Block } from './block';
import { Transaction } from './transaction';
import { LogRawValues, Log } from './log';

export type ReceiptRawValue = (Buffer | LogRawValues[])[];

export class Receipt {
  cumulativeGasUsed: Buffer;
  bitvector: Buffer;
  logs: Log[];
  status: 0 | 1;

  gasUsed?: BN;
  blockHash?: Buffer;
  blockNumber?: BN;
  contractAddress?: Buffer;
  from?: Buffer;
  to?: Buffer;
  transactionHash?: Buffer;
  transactionIndex?: number;

  get bnCumulativeGasUsed() {
    return new BN(this.cumulativeGasUsed);
  }

  constructor(cumulativeGasUsed: Buffer, bitvector: Buffer, logs: Log[], status: 0 | 1) {
    this.cumulativeGasUsed = cumulativeGasUsed;
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
    const [status, cumulativeGasUsed, bitvector, rawLogs] = values as [Buffer, Buffer, Buffer, LogRawValues[]];
    return new Receipt(
      cumulativeGasUsed,
      bitvector,
      rawLogs.map((rawLog) => Log.fromValuesArray(rawLog)),
      bufferToInt(status) === 0 ? 0 : 1
    );
  }

  raw(): ReceiptRawValue {
    return [unpadBuffer(toBuffer(this.status)), this.cumulativeGasUsed, this.bitvector, this.logs.map((l) => l.raw())];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  installProperties(block: Block, tx: Transaction, gasUsed: BN, txIndex: number) {
    this.blockHash = block.hash();
    this.blockNumber = block.header.number;
    this.from = tx.getSenderAddress().toBuffer();
    this.contractAddress = tx.to ? undefined : generateAddress(this.from!, tx.nonce.toArrayLike(Buffer));
    this.gasUsed = gasUsed;
    this.to = tx?.to?.toBuffer();
    this.transactionHash = tx.hash();
    this.transactionIndex = txIndex;

    this.logs.forEach((log, i) => log.installProperties(this, i));
  }

  toRPCJSON() {
    return {
      blockHash: this.blockHash ? bufferToHex(this.blockHash) : undefined,
      blockNumber: this.blockNumber ? bnToHex(this.blockNumber) : undefined,
      contractAddress: this.contractAddress ? bufferToHex(this.contractAddress) : null,
      cumulativeGasUsed: bufferToHex(this.cumulativeGasUsed),
      from: this.from ? bufferToHex(this.from) : undefined,
      gasUsed: this.gasUsed ? bnToHex(this.gasUsed) : undefined,
      logs: this.logs.map((log) => log.toRPCJSON()),
      logsBloom: bufferToHex(this.bitvector),
      status: intToHex(this.status),
      to: this.to ? bufferToHex(this.to) : undefined,
      transactionHash: this.transactionHash ? bufferToHex(this.transactionHash) : undefined,
      transactionIndex: this.transactionIndex !== undefined ? intToHex(this.transactionIndex) : undefined
    };
  }
}
