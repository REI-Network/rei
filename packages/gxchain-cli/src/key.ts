import Web3EthAccounts from 'web3-eth-accounts';
import { Address, bufferToHex, BN } from 'ethereumjs-util';

export interface KeyStore {
  getkey(add: Address, filename: string, auth: string);
  storekey(filename: string, k: any, auth: string);
  joinPath(filename: string): string;
}

export function keyFileName(keyAddr: Address): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + keyAddr.toString();
}
