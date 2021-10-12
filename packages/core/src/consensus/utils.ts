import { Address } from 'ethereumjs-util';
import { CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';

export const EMPTY_HASH = Buffer.alloc(32);
export const EMPTY_ADDRESS = Address.zero();
export const EMPTY_EXTRA_DATA = Buffer.alloc(CLIQUE_EXTRA_VANITY);

export function isEmptyAddress(address: Address) {
  return address.equals(EMPTY_ADDRESS);
}

export function isEmptyHash(hash: Buffer) {
  return hash.equals(EMPTY_HASH);
}
