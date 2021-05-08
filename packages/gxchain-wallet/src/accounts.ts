import { Transaction } from '@ethereumjs/tx';
import { Address, keccak256 } from 'ethereumjs-util';

type URL = {
  Scheme: string;
  Path: string;
};

export type addrtype = Address | string | Buffer;

export type Accountinfo = {
  address: Address;
  url: URL;
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

export function urlcompare(url1: URL, url2: URL): number {
  if (url1.Scheme === url2.Scheme) {
    return stringcompare(url1.Path, url2.Path);
  }
  return stringcompare(url1.Scheme, url2.Scheme);
}

export interface Wallet {
  url();

  status(): string;

  open(passphrase: string);

  close();

  accounts(): Accountinfo[];

  contain(account: Accountinfo): boolean;

  derive(path: Buffer, pin: boolean): Accountinfo | undefined;

  selfDerive(base: Buffer[]);

  signData(addr: addrtype, mimeType: string, data: Buffer): Buffer;

  signDataWithPassphrase(addr: addrtype, passphrase: string, mimeType: string, data: Buffer): Buffer;

  signText(addr: addrtype, text: Buffer): Buffer;

  signTextWithPassphrase(addr: addrtype, passphrase: string, text: Buffer): Buffer;

  signTx(addr: addrtype, tx: Transaction, chainID: number): Transaction;

  signTxWithPassphrase(addr: addrtype, passphrase: string, tx: Transaction, chainID: number): Transaction;
}

export function textAndHash(data: Buffer) {
  const msg = '\x19Ethereum Signed Message:\n%d%s' + data.toString();
  return keccak256(Buffer.from(msg));
}
