import fs from 'fs';
import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { hexStringToBuffer } from '@rei-network/utils';

/**
 * KeyStore manages a key storage directory on disk.
 */
export class KeyStore {
  private keyDirPath: string;

  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  /**
   * Loads and decrypts the key from disk.
   * @param path - Storage path
   * @param passphrase - Encryption password when storing
   * @param address - The account address
   * @returns Private key
   */
  async getKey(path: string, passphrase: string, address?: string): Promise<{ address: string; privateKey: string }> {
    const wallet = await Wallet.fromV3(fs.readFileSync(path).toString(), passphrase);
    const key = { address: wallet.getAddressString(), privateKey: wallet.getPrivateKeyString() };
    if (address && key.address.toLowerCase() !== address) {
      throw new Error('key content mismatch');
    }
    return key;
  }

  /**
   * Joins filename with the key directory unless it is already absolute.
   * @param filename - The stroage filename
   * @returns
   */
  joinPath(filename: string): string {
    return path.isAbsolute(filename) ? filename : path.join(this.keyDirPath, filename);
  }

  /**
   * Writes and encrypts the key.
   * @param fullPath - The stroage file full path
   * @param privateKey - Address private key
   * @param passphrase - Keystore passphrase
   */
  async storeKey(fullPath: string, privateKey: string, passphrase: string) {
    const keyStore = await Wallet.fromPrivateKey(hexStringToBuffer(privateKey)).toV3(passphrase);
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(keyStore));
  }
}

/**
 * keyStoreFileName implements the naming convention for keyfiles:
 * UTC--<created_at UTC ISO8601>-<address hex>
 * @param address - Account address
 * @returns Filename
 */
export function keyStoreFileName(address: string): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + (address.startsWith('0x') ? address.substr(2) : address);
}
