import { Address, bufferToHex, BN } from 'ethereumjs-util';

type keyStore = {
  getKey(add: Address);
};

export type KeyStore = {
  storage: keyStore;
};
