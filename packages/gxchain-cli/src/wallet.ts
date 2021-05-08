import { Wallet, Accountinfo, textAndHash } from './accounts';
import { keccak256 } from 'ethereumjs-util';
import { KeyStore } from './keystore';
import { Transaction } from '@ethereumjs/tx';

export class KeystoreWallet implements Wallet {
  account: Accountinfo;
  keystore: KeyStore;

  constructor(account: Accountinfo, ks: KeyStore) {
    this.account = account;
    this.keystore = ks;
  }

  url() {
    return this.account.url;
  }

  status(): string {
    const status = this.keystore.unlocked.get(this.account.address.toBuffer());
    if (status) {
      return 'Unlocked';
    }
    return 'Locked';
  }

  open(passphrase: string) {
    return;
  }

  close() {
    return;
  }

  accounts(): Accountinfo[] {
    return [this.account];
  }

  contain(account: Accountinfo): boolean {
    return account.address == this.account.address && account.url == this.account.url;
  }

  derive(path: Buffer, pin: boolean): Accountinfo | undefined {
    return;
  }

  selfDerive(base: Buffer[]) {
    return;
  }

  signHash(account: Accountinfo, hash: Buffer) {
    if (!this.contain(account)) {
      throw new Error('unknown account');
    }
    return this.keystore.signHash(account, hash);
  }

  signData(account: Accountinfo, mimeType: string, data: Buffer) {
    return this.signHash(account, keccak256(data));
  }

  signDataWithPassphrase(account: Accountinfo, passphrase, mimeType: string, data: Buffer) {
    if (!this.contain(account)) {
      throw new Error('unknown account');
    }
    return this.keystore.signHashWithPassphrase(account, passphrase, keccak256(data));
  }

  signText(account: Accountinfo, text: Buffer) {
    return this.signHash(account, textAndHash(text));
  }

  signTextWithPassphrase(account: Accountinfo, passphrase: string, text: Buffer) {
    if (!this.contain(account)) {
      throw new Error('unknown account');
    }
    return this.keystore.signHashWithPassphrase(account, passphrase, textAndHash(text));
  }

  signTx(account: Accountinfo, tx: Transaction, chainID: number): Transaction {
    if (!this.contain(account)) {
      throw new Error('unknown account');
    }
    return this.keystore.signTx(account, tx);
  }

  signTxWithPassphrase(account: Accountinfo, passphrase: string, tx: Transaction, chainID: number): Transaction {
    if (!this.contain(account)) {
      throw new Error('unknown account');
    }
    return this.keystore.signTxWithPassphrase(account, passphrase, tx);
  }
}
