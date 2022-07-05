import { bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { validateHash, validateInteger } from '../validate';
export interface SnapMessage {
  reqID: number;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class GetAccountRange implements SnapMessage {
  readonly reqID: number;
  readonly rootHash: Buffer;
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  static readonly code = 0;

  constructor(reqID: number, rootHash: Buffer, startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.reqID = reqID;
    this.rootHash = rootHash;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 5) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, rootHash, startHash, limitHash, responseLimitBuffer] = values;
    return new GetAccountRange(bufferToInt(reqIDBuffer), rootHash, startHash, limitHash, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.rootHash, this.startHash, this.limitHash, intToBuffer(this.responseLimit)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
    validateInteger(this.responseLimit);
    validateHash(this.rootHash);
    validateHash(this.startHash);
    validateHash(this.limitHash);
  }
}

export class AccountRange implements SnapMessage {
  readonly reqID: number;
  readonly accountData: Buffer[][];
  readonly proof: Buffer[];

  static readonly code = 1;

  constructor(reqID: number, accountData: Buffer[][], proof: Buffer[]) {
    this.reqID = reqID;
    this.accountData = accountData;
    this.proof = proof;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[] | Buffer[][])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, accountData, proof] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(accountData) || !Array.isArray(proof)) {
      throw new Error('invalid values');
    }

    for (const account of accountData) {
      if (!Array.isArray(account) || account.length !== 2) {
        throw new Error('invalid values');
      }
    }

    return new AccountRange(bufferToInt(reqIDBuffer), accountData as Buffer[][], proof as Buffer[]);
  }

  raw() {
    return [intToBuffer(this.reqID), this.accountData, this.proof];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
  }
}

export class GetStorageRange implements SnapMessage {
  readonly reqID: number;
  readonly rootHash: Buffer;
  readonly accountHashes: Buffer[];
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  static readonly code = 2;

  constructor(reqID: number, rootHash: Buffer, accountHashes: Buffer[], startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.reqID = reqID;
    this.rootHash = rootHash;
    this.accountHashes = accountHashes;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 6) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, rootHash, accountHashes, startHash, limitHash, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !(rootHash instanceof Buffer) || !Array.isArray(accountHashes) || !(startHash instanceof Buffer) || !(limitHash instanceof Buffer) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetStorageRange(bufferToInt(reqIDBuffer), rootHash, accountHashes, startHash, limitHash, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.rootHash, this.accountHashes, this.startHash, this.limitHash, intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
    validateInteger(this.responseLimit);
    validateHash(this.rootHash);
    validateHash(this.startHash);
    validateHash(this.limitHash);
    for (const accountHash of this.accountHashes) {
      validateHash(accountHash);
    }
  }
}

export class StorageRange implements SnapMessage {
  readonly reqID: number;
  readonly slots: Buffer[][][];
  readonly proof: Buffer[];

  static readonly code = 3;

  constructor(reqID: number, slots: Buffer[][][], proof: Buffer[]) {
    this.reqID = reqID;
    this.slots = slots;
    this.proof = proof;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[] | Buffer[][][])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, storage, proof] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(storage) || !Array.isArray(proof)) {
      throw new Error('invalid values');
    }
    for (const slot of storage) {
      if (!Array.isArray(slot)) {
        throw new Error('invalid values');
      } else {
        for (const s of slot) {
          if (!Array.isArray(s) || s.length !== 2) {
            throw new Error('invalid values');
          }
        }
      }
    }
    return new StorageRange(bufferToInt(reqIDBuffer), storage as Buffer[][][], proof as Buffer[]);
  }

  raw() {
    return [intToBuffer(this.reqID), this.slots, this.proof];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
  }
}

export class GetByteCode implements SnapMessage {
  readonly reqID: number;
  readonly hashes: Buffer[];
  readonly responseLimit: number;

  static readonly code = 4;

  constructor(reqID: number, hashes: Buffer[], responseLimit: number) {
    this.reqID = reqID;
    this.hashes = hashes;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, hashes, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(hashes) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetByteCode(bufferToInt(reqIDBuffer), hashes, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.hashes, intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
  validateBasic(): void {
    validateInteger(this.reqID);
    validateInteger(this.responseLimit);
    for (const hash of this.hashes) {
      validateHash(hash);
    }
  }
}

export class ByteCode implements SnapMessage {
  readonly reqID: number;
  readonly codes: Buffer[];

  static readonly code = 5;

  constructor(reqID: number, codes: Buffer[]) {
    this.reqID = reqID;
    this.codes = codes;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, codeHashes] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(codeHashes)) {
      throw new Error('invalid values');
    }
    return new ByteCode(bufferToInt(reqIDBuffer), codeHashes);
  }

  raw() {
    return [intToBuffer(this.reqID), this.codes];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
  }
}

export class GetTrieNode implements SnapMessage {
  readonly reqID: number;
  readonly hashes: Buffer[];
  readonly responseLimit: number;

  static readonly code = 6;

  constructor(reqID: number, hashes: Buffer[], responseLimit: number) {
    this.reqID = reqID;
    this.hashes = hashes;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, hashes, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(hashes) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetTrieNode(bufferToInt(reqIDBuffer), hashes, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.hashes, intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
    validateInteger(this.responseLimit);
    for (const hash of this.hashes) {
      validateHash(hash);
    }
  }
}

export class TrieNode implements SnapMessage {
  readonly reqID: number;
  readonly nodes: Buffer[];

  static readonly code = 7;

  constructor(reqID: number, nodes: Buffer[]) {
    this.reqID = reqID;
    this.nodes = nodes;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, nodes] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(nodes)) {
      throw new Error('invalid values');
    }
    return new TrieNode(bufferToInt(reqIDBuffer), nodes);
  }

  raw() {
    return [intToBuffer(this.reqID), this.nodes];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    validateInteger(this.reqID);
  }
}
