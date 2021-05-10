import { Transaction } from '@ethereumjs/tx';
import { Address, keccak256 } from 'ethereumjs-util';

export type addrtype = Address | string | Buffer;

export type Accountinfo = {
  address: Address;
  path: string;
};

function stringcompare(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

export interface Wallet {
  path(): string;

  status(): string;

  accounts(): Accountinfo[];

  contain(account: Accountinfo): boolean;

  signData(addr: addrtype, mimeType: string, data: Buffer): Buffer;

  signDataWithPassphrase(addr: addrtype, passphrase: string, mimeType: string, data: Buffer): Buffer;

  signText(addr: addrtype, text: Buffer): Buffer;

  signTextWithPassphrase(addr: addrtype, passphrase: string, text: Buffer): Buffer;

  signTx(addr: addrtype, tx: Transaction, chainID: number): Transaction;

  signTxWithPassphrase(addr: addrtype, passphrase: string, tx: Transaction, chainID: number): Transaction;
}
