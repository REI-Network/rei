import { Transaction } from '@ethereumjs/tx';
import { Address, bufferToHex, BN } from 'ethereumjs-util';

type URL = {
  Scheme: string;
  Path: string;
};

export type Account = {
  address: Address;
  url: URL;
};

function stringcompare(a: string, b: string) {
  if (a == b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

export function urlcompare(url1: URL, url2: URL): number {
  if (url1.Scheme == url2.Scheme) {
    return stringcompare(url1.Path, url2.Path);
  }
  return stringcompare(url1.Scheme, url2.Scheme);
}

export interface Wallet {
  url();

  status(): string;

  Open(passphrase: string);

  close();

  accounts(): Account[];

  contain(account: Account): boolean;

  derive(path: Buffer, pin: boolean): Account;

  selfDerive(base: Buffer[]); //todo anther  parameter

  signData(account: Account, mimeType: string, data: Buffer): Buffer;

  signDataWithPassphrase(account: Account, passphrase, mimeType: string, data: Buffer): Buffer;

  signText(account: Account, text: Buffer): Buffer;

  signTextWithPassphrase(account: Account, passphrase: string, text: Buffer): Buffer;

  signTx(account: Account, tx: Transaction, chainID: number): Transaction;

  signTxWithPassphrase(account: Account, passphrase: string, tx: Transaction, chainID: number): Transaction;
}

export type Backend = {
  wallets(): Wallet[];
  subscribe();
};
