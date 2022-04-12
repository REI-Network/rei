import crypto from 'crypto';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Account, BN, keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap } from '@rei-network/utils';
import { Database, DBSaveSnapStorage, DBSaveSerializedSnapAccount } from '@rei-network/database';

export class AccountInfo {
  address: Buffer;
  code: Buffer;
  account: Account;
  storageData: FunctionalBufferMap<{ key: Buffer; val: Buffer }>;

  constructor(address: Buffer, code: Buffer, account: Account, storageData: FunctionalBufferMap<{ key: Buffer; val: Buffer }>) {
    this.address = address;
    this.code = code;
    this.account = account;
    this.storageData = storageData;
  }

  copy() {
    const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
    for (const [k, v] of this.storageData) {
      storageData.set(k, { ...v });
    }
    return new AccountInfo(Buffer.from(this.address), Buffer.from(this.code), new Account(this.account.nonce.clone(), this.account.balance.clone(), Buffer.from(this.account.stateRoot)), storageData);
  }
}

/**
 * Randomly generate several accounts and 10 random storage data for each account
 * @param db
 * @param _accounts
 * @param slots
 * @returns Account list and state root
 */
export async function genRandomAccounts(db: Database, _accounts: number, slots: number, saveSnap = true) {
  const stateTrie = new Trie(db.rawdb);
  const accounts: AccountInfo[] = [];

  for (let i = 0; i < _accounts; i++) {
    const address = crypto.randomBytes(20);
    const code = crypto.randomBytes(100);
    const codeHash = keccak256(code);
    await db.rawdb.put(codeHash, code, { keyEncoding: 'binary', valueEncoding: 'binary' });
    const accountHash = keccak256(address);
    const storageTrie = new Trie(db.rawdb);
    const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
    for (let i = 0; i < slots; i++) {
      const storageKey = crypto.randomBytes(32);
      const storageValue = crypto.randomBytes(32);
      const storageHash = keccak256(storageKey);
      if (saveSnap) {
        await db.batch([DBSaveSnapStorage(accountHash, storageHash, storageValue)]);
      }
      await storageTrie.put(storageKey, storageValue);
      storageData.set(storageHash, {
        key: storageKey,
        val: storageValue
      });
    }
    const account = new Account(new BN(1), new BN(1), storageTrie.root, codeHash);
    if (saveSnap) {
      await db.batch([DBSaveSerializedSnapAccount(accountHash, account.serialize())]);
    }
    await stateTrie.put(address, account.serialize());
    accounts.push(new AccountInfo(address, code, account, storageData));
  }

  return {
    root: stateTrie.root,
    accounts
  };
}
