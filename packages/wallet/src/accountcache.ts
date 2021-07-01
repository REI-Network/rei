import fs from 'fs';
import { createBufferFunctionalMap, hexStringToBuffer } from '@gxchain2/utils';
import { FileCache } from './filecache';

export type AccountInfo = {
  addrBuf: Buffer;
  path: string;
};

/**
 * This class is used to manage the information of the account in memory
 */
export class AccountCache {
  private keydir: string;
  private fileCache = new FileCache();
  private addrToPath = createBufferFunctionalMap<string>();

  constructor(keydir: string) {
    this.keydir = keydir;
  }

  /**
   * Get all accounts information
   * @returns Accountinfo array
   */
  accounts(): AccountInfo[] {
    this.scanAccounts();
    return Array.from(this.addrToPath.entries()).map(([addrBuf, path]) => {
      return {
        addrBuf,
        path
      };
    });
  }

  /**
   * Determine whether the account exists in cache
   * @param addrBuf Buffer of address
   * @returns `true` if exist
   */
  has(addrBuf: Buffer): boolean {
    this.scanAccounts();
    return !!this.addrToPath.get(addrBuf);
  }

  /**
   * Get account information of an address where it is stored
   * @param addrBuf The Buffer of address
   * @returns Storage path of the account
   */
  get(addrBuf: Buffer) {
    return this.addrToPath.get(addrBuf);
  }

  /**
   * Add address and storage path of the account to map
   * @param addrBuf The Buffer of address
   * @param path Storage path of the account
   */
  add(addrBuf: Buffer, path: string) {
    this.addrToPath.set(addrBuf, path);
  }

  /**
   * According to the storage path of the account file,
   * put the account information into the memory
   * @param path Storage path of the account
   */
  private addByPath(path: string) {
    const keyjson = JSON.parse(fs.readFileSync(path).toString());
    return this.addrToPath.set(hexStringToBuffer(keyjson.address), path);
  }

  /**
   * According to the storage path of the account file,
   * delete the account information from the memory
   * @param addrPath
   * @returns
   */
  private deleteByPath(addrPath: string) {
    for (const [addrBuf, path] of this.addrToPath) {
      if (path === addrPath) {
        this.addrToPath.delete(addrBuf);
        return;
      }
    }
  }

  /**
   * According to the change of the stored file, add, delete
   * or update the memory
   */
  private scanAccounts() {
    const [creates, deletes, updates] = this.fileCache.scan(this.keydir);
    for (const fi of creates) {
      this.addByPath(fi);
    }
    for (const fi of deletes) {
      this.deleteByPath(fi);
    }
    for (const fi of updates) {
      this.deleteByPath(fi);
      this.addByPath(fi);
    }
  }
}
