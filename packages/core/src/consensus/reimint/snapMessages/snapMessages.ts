import { BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { StakingAccount } from '../../../stateManager';

export interface SnapMessage {
  response?: number;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class GetAccountRange implements SnapMessage {
  readonly root: Buffer;
  readonly startHash: Buffer;
  readonly limitHash: Buffer;

  constructor(root: Buffer, start: Buffer, limit: Buffer) {
    this.root = root;
    this.startHash = start;
    this.limitHash = limit;
    this.validateBasic();
  }

  static readonly code = 0;
  static readonly response = 1;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }
    return new GetAccountRange(values[0], values[1], values[2]);
  }

  raw() {
    return [this.root, this.startHash, this.limitHash];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class AccountRange implements SnapMessage {
  readonly accountHash: Buffer[];
  readonly accountBody: Buffer[];
  readonly proofs: Buffer[];

  constructor(accountHash: Buffer[], accountBody: Buffer[], proofs: Buffer[]) {
    this.accountHash = accountHash;
    this.accountBody = accountBody;
    this.proofs = proofs;
  }

  static readonly code = 1;

  static fromValuesArray(values: Buffer[][]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    return new AccountRange(values[0], values[1], values[2]);
  }
  raw() {
    return [[...this.accountHash], [...this.accountBody], [...this.proofs]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    if (this.accountHash.length !== this.accountBody.length) {
      throw new Error('invaild accountHash and accountBody count');
    }
  }
}

export class GetStorageRange implements SnapMessage {
  readonly rootHash: Buffer;
  readonly accountHashes: Buffer[];
  readonly startingHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseBytes: number;

  constructor(rootHash: Buffer, accountHashes: Buffer[], startingHash: Buffer, limitHash: Buffer, responseBytes: number) {
    this.rootHash = rootHash;
    this.accountHashes = accountHashes;
    this.startingHash = startingHash;
    this.limitHash = limitHash;
    this.responseBytes = responseBytes;
    this.validateBasic();
  }

  static readonly code = 2;
  static readonly response = 3;

  static fromValuesArray(values: Buffer[][]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    return new GetStorageRange(values[0][0], values[1], values[2][0], values[3][0], bufferToInt(values[4][0]));
  }

  raw() {
    return [[...this.rootHash], [...this.accountHashes], [...this.startingHash], [...this.limitHash], [...intToBuffer(this.responseBytes)]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class StorageRange implements SnapMessage {
  readonly slotHashes: Buffer[];
  readonly slotData: Buffer[];
  readonly proof: Buffer[];
  static readonly code = 3;

  constructor(slotHashes: Buffer[], slotData: Buffer[], proof: Buffer[]) {
    this.slotHashes = slotHashes;
    this.slotData = slotData;
    this.proof = proof;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[][]) {
    return new StorageRange(values[0], values[1], values[2]);
  }

  raw() {
    return [[...this.slotHashes], [...this.slotData], [...this.proof]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    if (this.slotData.length !== this.slotHashes.length) {
      throw new Error('invaild slotHash and slotData count');
    }
  }
}

export class GetByteCode implements SnapMessage {
  readonly hashes: Buffer[];
  readonly bytes: number;

  constructor(hashes: Buffer[], bytes: number) {
    this.hashes = hashes;
    this.bytes = bytes;
    this.validateBasic();
  }

  static readonly code = 4;
  static readonly response = 5;

  static fromValuesArray(values: Buffer[][]) {
    return new GetByteCode(values[0], bufferToInt(values[1][0]));
  }

  raw() {
    return [[...this.hashes], [...intToBuffer(this.bytes)]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
  validateBasic(): void {}
}

export class ByteCode implements SnapMessage {
  readonly codesHash: Buffer[];

  constructor(codeHash: Buffer[]) {
    this.codesHash = codeHash;
    this.validateBasic();
  }

  static readonly code = 5;
  static fromValuesArray(values: Buffer[]) {
    return new ByteCode(values);
  }

  raw() {
    return [...this.codesHash];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetTrieNode implements SnapMessage {
  readonly rootHash: Buffer;
  readonly paths: Buffer[][];
  readonly bytes: number;

  constructor(rootHash: Buffer, paths: Buffer[][], bytes: number) {
    this.rootHash = rootHash;
    this.paths = paths;
    this.bytes = bytes;
    this.validateBasic();
  }

  static readonly code = 6;
  static readonly response = 7;

  static fromValuesArray(values: Buffer[][][]) {
    return new GetTrieNode(values[0][0][1], values[1], bufferToInt(values[2][0][0]));
  }

  raw() {
    return [[[...this.rootHash]], [...this.paths], [[...intToBuffer(this.bytes)]]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class TrieNode implements SnapMessage {
  readonly nodes: Buffer[][];

  constructor(nodes: Buffer[][]) {
    this.nodes = nodes;
    this.validateBasic();
  }

  static readonly code = 7;

  static fromValuesArray(values: Buffer[][]) {
    return new TrieNode(values);
  }

  raw() {
    return [...this.nodes];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}
