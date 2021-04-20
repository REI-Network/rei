import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { keyStore } from './key';
import { Account } from 'web3-core';
import { Wallet, Accountinfo } from './accounts';
import { AccountCache } from './accountcache';
import { Transaction } from '@ethereumjs/tx';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { Accounts } from 'web3-eth-accounts';

const web3accounts = new Accounts();

export class KeyStore {
  storage: keyStore;
  cache: AccountCache;
  unlocked: FunctionalMap<Buffer, Account>;
  wallets: Wallet[];

  constructor(keydir: string, ks: keyStore) {
    this.storage = ks;
    this.unlocked = createBufferFunctionalMap<Account>();
    this.cache = new AccountCache(keydir);
    let accs = this.cache.accounts;
    this.wallets = [];
    for (let i = 0; i < accs.length; i++) {
      this.wallets.push();
    }
  }

  getDecryptedKey(a: Accountinfo, auth: string) {
    const account = this.cache.find(a);
    const key = this.storage.getkey(a.address, a.url.Path, auth);
    return [account, key];
  }

  signHash(a: Accountinfo, hash: Buffer) {
    const unlockedKey = this.unlocked.get(a.address.toBuffer());
    if (!unlockedKey) {
      throw new Error('password or unlock');
    }
    return web3accounts.sign(hash.toString(), unlockedKey.privateKey);
  }

  signHashWithPassphrase(a: Accountinfo, passphrase: string, hash: Buffer) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return web3accounts.sign(hash.toString(), key.privateKeyb);
  }

  signTx(a: Accountinfo, tx: Transaction) {
    const unlockedKey = this.unlocked.get(a.address.toBuffer());
    if (!unlockedKey) {
      throw new Error('password or unlock');
    }
    return tx.sign(Buffer.from(unlockedKey.privateKey));
  }

  signTxWithPassphrase(a: Accountinfo, passphrase: string, tx: Transaction) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return tx.sign(Buffer.from(key.privateKey));
  }
}
