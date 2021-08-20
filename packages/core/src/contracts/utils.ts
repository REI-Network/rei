import { Address, setLengthLeft, BN, MAX_INTEGER } from 'ethereumjs-util';

const MAX_INTEGER_256 = new BN('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const MIN_INTEGER_256 = new BN('8000000000000000000000000000000000000000000000000000000000000000', 'hex').neg();

export function bufferToAddress(buf: Buffer) {
  return new Address(buf.slice(buf.length - 20));
}

export function toContractCallData(data: Buffer[]) {
  return data.map((buf) => setLengthLeft(buf, 32));
}

export function bnToInt256Buffer(bn: BN) {
  return (bn.isNeg() ? MAX_INTEGER.sub(bn).addn(1) : bn).toBuffer();
}

export function int256BufferToBN(buf: Buffer) {
  const bn = new BN(buf);
  return bn.gt(MAX_INTEGER_256) ? MAX_INTEGER.sub(bn).addn(1).neg() : bn;
}
