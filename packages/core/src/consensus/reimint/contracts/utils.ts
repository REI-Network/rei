import { Address, BN, toBuffer } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';

const coder = new AbiCoder();

// convert buffer to address
export function bufferToAddress(buf: Buffer) {
  return new Address(buf.slice(buf.length - 20));
}

// abi encode values by types
export function encode(types: string[], values: any[]) {
  if (types.length === 0) {
    return Buffer.from([]);
  }
  return toBuffer(coder.encode(types, values));
}

// decode int256 type
export function decodeInt256(buf: Buffer) {
  return new BN(coder.decode(['int256'], buf)[0].toString());
}

export function decodeBytes(buf: Buffer): string {
  return coder.decode(['bytes'], buf)[0];
}
