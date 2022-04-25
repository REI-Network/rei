import crypto from 'crypto';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Account, BN, keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap, FunctionalBufferSet, getRandomIntInclusive } from '@rei-network/utils';
import { Database, DBSaveSnapStorage, DBSaveSerializedSnapAccount } from '@rei-network/database';
import { Snapshot } from '../../src/snap/types';
import { DiffLayer } from '../../src/snap/diffLayer';

export class AccountInfo {
  address: Buffer;
  code: Buffer;
  accountHash: Buffer;
  account: Account;
  storageData: FunctionalBufferMap<{ key: Buffer; val: Buffer }>;
  lastestStorageHash: Buffer;

  constructor(address: Buffer, code: Buffer, accountHash: Buffer, account: Account, storageData: FunctionalBufferMap<{ key: Buffer; val: Buffer }>, lastestStorageHash: Buffer) {
    this.address = address;
    this.code = code;
    this.accountHash = accountHash;
    this.account = account;
    this.storageData = storageData;
    this.lastestStorageHash = lastestStorageHash;
  }

  copy() {
    const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
    for (const [k, v] of this.storageData) {
      storageData.set(k, { key: Buffer.from(v.key), val: Buffer.from(v.val) });
    }
    return new AccountInfo(Buffer.from(this.address), Buffer.from(this.code), Buffer.from(this.accountHash), new Account(this.account.nonce.clone(), this.account.balance.clone(), Buffer.from(this.account.stateRoot)), storageData, Buffer.from(this.lastestStorageHash));
  }
}

export type GenRandomAccountsResult = {
  root: Buffer;
  accounts: AccountInfo[];
  lastestAccountHash: Buffer;
};

/**
 * Randomly generate several accounts and 10 random storage data for each account
 * @param db
 * @param _accounts
 * @param slots
 * @returns Account list and state root
 */
export async function genRandomAccounts(db: Database, _accounts: number, slots: number, saveSnap = true): Promise<GenRandomAccountsResult> {
  const stateTrie = new Trie(db.rawdb);
  const accounts: AccountInfo[] = [];
  let lastestAccountHash: Buffer | undefined;

  for (let i = 0; i < _accounts; i++) {
    const address = crypto.randomBytes(20);
    const code = crypto.randomBytes(100);
    const codeHash = keccak256(code);
    await db.rawdb.put(codeHash, code, { keyEncoding: 'binary', valueEncoding: 'binary' });
    const accountHash = keccak256(address);
    const storageTrie = new Trie(db.rawdb);
    const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
    let lastestStorageHash: Buffer | undefined;
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

      if (lastestStorageHash === undefined || lastestStorageHash.compare(storageHash) < 0) {
        lastestStorageHash = storageHash;
      }
    }
    const account = new Account(new BN(1), new BN(1), storageTrie.root, codeHash);
    if (saveSnap) {
      await db.batch([DBSaveSerializedSnapAccount(accountHash, account.serialize())]);
    }
    await stateTrie.put(address, account.serialize());
    accounts.push(new AccountInfo(address, code, accountHash, account, storageData, lastestStorageHash!));

    if (lastestAccountHash === undefined || lastestAccountHash.compare(accountHash) < 0) {
      lastestAccountHash = accountHash;
    }
  }

  return {
    root: stateTrie.root,
    accounts,
    lastestAccountHash: lastestAccountHash!
  };
}

/**
 * Randomly modify several accounts based on the last layer
 * @param db
 * @param root
 * @param lastLayerAccounts - Last layer account list
 * @param modifyCount
 * @returns Next layer account list and new state root
 */
export async function modifyRandomAccounts(db: Database, root: Buffer, lastLayerAccounts: AccountInfo[], modifyCount: number) {
  lastLayerAccounts = [...lastLayerAccounts];
  const stateTrie = new Trie(db.rawdb, root);
  const accounts: AccountInfo[] = [];

  for (let i = 0; i < modifyCount; i++) {
    const index = getRandomIntInclusive(0, lastLayerAccounts.length - 1);
    const modifiedAccount = lastLayerAccounts[index].copy();
    const { address, account, storageData } = modifiedAccount;
    lastLayerAccounts.splice(index, 1);

    // randomly modify several keys
    const keys = Array.from(storageData.keys());
    const modifiedKeyCount = Math.ceil(keys.length / 2);
    const modifiedKeys: Buffer[] = [];
    for (let i = 0; i < modifiedKeyCount; i++) {
      const index = getRandomIntInclusive(0, keys.length - 1);
      const modifiedKey = keys[index];
      const { key, val } = storageData.get(modifiedKey)!;
      modifiedKeys.push(modifiedKey);
      keys.splice(index, 1);

      let newValue = crypto.randomBytes(32);
      while (newValue.equals(val)) {
        newValue = crypto.randomBytes(32);
      }

      storageData.set(modifiedKey, {
        key,
        val: newValue
      });
      const storageTrie = new Trie(db.rawdb, account.stateRoot);
      await storageTrie.put(key, newValue);
      account.stateRoot = storageTrie.root;
    }

    // delete all unmodified keys
    for (const key of keys) {
      storageData.delete(key);
    }

    await stateTrie.put(address, account.serialize());

    accounts.push(modifiedAccount);
  }

  return {
    root: stateTrie.root,
    accounts
  };
}

/**
 * Convert account list to diff layer
 * @param parent
 * @param root
 * @param accounts
 * @returns Diff layer
 */
export function accountsToDiffLayer(parent: Snapshot, root: Buffer, accounts: AccountInfo[]) {
  const destructSet = new FunctionalBufferSet();
  const accountData = new FunctionalBufferMap<Buffer>();
  const storageData = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();

  for (const { address, account, storageData: _storageData } of accounts) {
    const accountHash = keccak256(address);
    accountData.set(accountHash, account.serialize());
    let storage = storageData.get(accountHash);
    if (!storage) {
      storage = new FunctionalBufferMap<Buffer>();
      storageData.set(accountHash, storage);
    }
    for (const [storageHash, storageValue] of _storageData) {
      storage.set(storageHash, storageValue.val);
    }
  }

  return DiffLayer.createDiffLayerFromParent(parent, root, destructSet, accountData, storageData);
}
