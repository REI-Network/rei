import { Address } from 'ethereumjs-util';

export function bufferToAddress(buf: Buffer) {
  return new Address(buf.slice(buf.length - 20));
}
