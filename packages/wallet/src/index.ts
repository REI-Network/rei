import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { Address, bufferToHex } from 'ethereumjs-util';
import { FunctionalBufferMap, hexStringToBuffer } from '@rei-network/utils';
import { AccountCache } from './accountCache';
import { KeyStore, keyStoreFileName } from './keystore';

type AddrType = Address | string | Buffer;

/**
 * Convert address to buffer
 * @param addr - Address
 * @returns Buffer
 */
function addrToBuffer(addr: AddrType) {
  if (!Buffer.isBuffer(addr)) {
    addr = typeof addr === 'object' ? addr.toBuffer() : hexStringToBuffer(addr);
  }
  return addr;
}

/**
 * Convert the address to string
 * @param addr - Address
 * @returns String with `0x` prefix
 */
function addrToString(addr: AddrType) {
  if (Buffer.isBuffer(addr)) {
    return bufferToHex(addr);
  } else if (addr instanceof Address) {
    return addr.toString();
  }
  return (addr.startsWith('0x') ? addr : '0x' + addr).toLowerCase();
}

export class AccountManager {
  private storage: KeyStore;
  private cache: AccountCache;
  private unlocked = new FunctionalBufferMap<Buffer>();

  /**
   * @param keydir - Keystore dir full path
   */
  constructor(keydir: string) {
    if (!path.isAbsolute(keydir)) {
      keydir = path.join(process.cwd(), keydir);
    }
    this.storage = new KeyStore(keydir);
    this.cache = new AccountCache(keydir);
    this.cache.accounts();
  }

  /**
   * Loads and decrypts the key from disk.
   * @param addr - Address
   * @param passphrase - Decryption password
   * @returns Private key
   */
  private async getDecryptedKey(addr: AddrType, passphrase: string) {
    this.cache.accounts();
    const path = this.cache.get(addrToBuffer(addr));
    if (!path) {
      throw new Error('unknown account');
    }
    return { ...(await this.storage.getKey(path, passphrase, addrToString(addr))), path };
  }

  /**
   * Get all accounts in cache
   * @returns Array of accounts
   */
  totalAccounts() {
    return this.cache.accounts();
  }

  /**
   * Whether the account exists in cache
   * @param addr - Address
   * @returns `true` if exists
   */
  hasAccount(addr: AddrType) {
    return this.cache.has(addrToBuffer(addr));
  }

  /**
   * Get all unlocked accounts in cache
   * @returns The unlocked accounts array
   */
  totalUnlockedAccounts() {
    return Array.from(this.unlocked.keys());
  }

  /**
   * Whether the unlocked account exists in cache
   * @param addr - Unlocked account address
   * @returns `true` if exists
   */
  hasUnlockedAccount(addr: AddrType) {
    return this.unlocked.has(addrToBuffer(addr));
  }

  /**
   * Get private key from the unlocked map
   * @param addr - Unlocked account address
   */
  getPrivateKey(addr: AddrType) {
    const privateKey = this.unlocked.get(addrToBuffer(addr));
    if (!privateKey) {
      throw new Error(`Unknown address: ${addrToString(addr)}`);
    }
    return privateKey;
  }

  /**
   * Lock account and delete the account from the map
   * @param addr - Unlocked account address
   */
  lock(addr: AddrType) {
    this.unlocked.delete(addrToBuffer(addr));
  }

  /**
   * Unlock account, add account information to the map
   * @param addr - Account address
   * @param passphrase - Decryption password
   * @returns `true` if unlock succed
   */
  async unlock(addr: AddrType, passphrase: string) {
    try {
      const buf = addrToBuffer(addr);
      if (!this.unlocked.has(buf)) {
        const { privateKey } = await this.getDecryptedKey(addr, passphrase);
        this.unlocked.set(buf, hexStringToBuffer(privateKey));
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * ImportKey stores the given account into the key directory and
   * add into the cache
   * @param path - The storage path
   * @param passphrase - Decryption password
   * @returns Account address
   */
  async importKey(path: string, passphrase: string) {
    const { address, privateKey } = await this.storage.getKey(path, passphrase);
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  /**
   * Import account by privateKey, store it in disk and add it to cache
   * @param privateKey - Private key
   * @param passphrase - Encryption password
   * @returns Account address
   */
  async importKeyByPrivateKey(privateKey: string, passphrase: string) {
    const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  /**
   * Update account passphrase
   * @param addr - Account address
   * @param passphrase - Old passphrase
   * @param newPassphrase - New passphrase
   */
  async update(addr: AddrType, passphrase: string, newPassphrase: string) {
    const { privateKey, path } = await this.getDecryptedKey(addr, passphrase);
    await this.storage.storeKey(path, privateKey, newPassphrase);
  }

  /**
   * Create a account, store it with encryption passphrase
   * @param passphrase - Encryption password
   * @returns New Account address and storage path
   */
  async newAccount(passphrase: string) {
    const wallet = Wallet.generate();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return { address, path: localPath };
  }
}
