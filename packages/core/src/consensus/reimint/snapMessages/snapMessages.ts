import { BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { StakingAccount } from '../../../stateManager';

export interface SnapMessage {
  code?: number;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class GetAccountRange implements SnapMessage {
  readonly rootHash: Buffer;
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  constructor(rootHash: Buffer, startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.rootHash = rootHash;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 0;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }
    return new GetAccountRange(values[0], values[1], values[2], bufferToInt(values[3]));
  }

  raw() {
    return [this.rootHash, this.startHash, this.limitHash, ...intToBuffer(this.responseLimit)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class AccountRange implements SnapMessage {
  readonly accountData: Buffer[][] = [];
  readonly proofs: Buffer[][];

  constructor(accountData: Buffer[][], proofs: Buffer[][]) {
    this.accountData = accountData;
    this.proofs = proofs;
  }

  static readonly code = 1;

  static fromValuesArray(values: Buffer[][][]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    return new AccountRange(values[0], values[1]);
  }
  raw() {
    return [[...this.accountData], [...this.proofs]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetStorageRange implements SnapMessage {
  readonly rootHash: Buffer;
  readonly accountHashes: Buffer[];
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  constructor(rootHash: Buffer, accountHashes: Buffer[], startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.rootHash = rootHash;
    this.accountHashes = accountHashes;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 2;

  static fromValuesArray(values: Buffer[][]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    return new GetStorageRange(values[0][0], values[1], values[2][0], values[3][0], bufferToInt(values[4][0]));
  }

  raw() {
    return [[...this.rootHash], [...this.accountHashes], [...this.startHash], [...this.limitHash], [...intToBuffer(this.responseLimit)]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class StorageRange implements SnapMessage {
  readonly storage: Buffer[][][] = [];
  readonly proof: Buffer[][];
  static readonly code = 3;

  constructor(storage: Buffer[][][], proof: Buffer[][]) {
    this.storage = storage;
    this.proof = proof;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[][][][]) {
    return new StorageRange(values[0], values[1][0]);
  }

  raw() {
    return [[...this.storage], [...this.proof]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetByteCode implements SnapMessage {
  readonly hashes: Buffer[];
  readonly responseLimit: number;

  constructor(hashes: Buffer[], responseLimit: number) {
    this.hashes = hashes;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 4;

  static fromValuesArray(values: Buffer[][]) {
    return new GetByteCode(values[0], bufferToInt(values[1][0]));
  }

  raw() {
    return [[...this.hashes], [...intToBuffer(this.responseLimit)]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
  validateBasic(): void {}
}

export class ByteCode implements SnapMessage {
  readonly codesHashes: Buffer[];

  constructor(codeHashes: Buffer[]) {
    this.codesHashes = codeHashes;
    this.validateBasic();
  }

  static readonly code = 5;
  static fromValuesArray(values: Buffer[]) {
    return new ByteCode(values);
  }

  raw() {
    return [...this.codesHashes];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetTrieNode implements SnapMessage {
  readonly rootHash: Buffer;
  readonly paths: Buffer[][];
  readonly responseLimit: number;

  constructor(rootHash: Buffer, paths: Buffer[][], responseLimit: number) {
    this.rootHash = rootHash;
    this.paths = paths;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 6;

  static fromValuesArray(values: Buffer[][][]) {
    return new GetTrieNode(values[0][0][1], values[1], bufferToInt(values[2][0][0]));
  }

  raw() {
    return [[[...this.rootHash]], [...this.paths], [[...intToBuffer(this.responseLimit)]]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class TrieNode implements SnapMessage {
  readonly nodes: Buffer[];

  constructor(nodes: Buffer[]) {
    this.nodes = nodes;
    this.validateBasic();
  }

  static readonly code = 7;

  static fromValuesArray(values: Buffer[]) {
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
