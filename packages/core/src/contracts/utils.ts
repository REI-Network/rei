import { Address, BN, toBuffer } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';

const coder = new AbiCoder();

// const MAX_INTEGER_256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
// const MIN_INTEGER_256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();

export function bufferToAddress(buf: Buffer) {
  return new Address(buf.slice(buf.length - 20));
}

export function encode(types: string[], values: any[]) {
  if (types.length === 0) {
    return Buffer.from([]);
  }
  return toBuffer(coder.encode(types, values));
}

export function decodeInt256(buf: Buffer) {
  return new BN(coder.decode(['int256'], buf)[0].toString());
}

// export function bnToInt256Buffer(bn: BN) {
//   return (bn.isNeg() ? MAX_INTEGER.sub(bn).addn(1) : bn).toBuffer();
// }

// export function int256BufferToBN(buf: Buffer) {
//   const bn = new BN(buf);
//   return bn.gt(MAX_INTEGER_256) ? MAX_INTEGER.sub(bn).addn(1).neg() : bn;
// }
