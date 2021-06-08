import fs from 'fs';
import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { hexStringToBuffer } from '@gxchain2/utils';

export class KeyStore {
  private keyDirPath: string;

  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  async getKey(path: string, passphrase: string, address?: string): Promise<{ address: string; privateKey: string }> {
    const wallet = await Wallet.fromV3(fs.readFileSync(path).toString(), passphrase);
    const key = { address: wallet.getAddressString(), privateKey: wallet.getPrivateKeyString() };
    if (address && key.address.toLowerCase() !== address) {
      throw new Error('key content mismatch');
    }
    return key;
  }

  joinPath(filename: string): string {
    return path.isAbsolute(filename) ? filename : path.join(this.keyDirPath, filename);
  }

  async storeKey(fullPath: string, privateKey: string, passphrase: string) {
    const keyStore = await Wallet.fromPrivateKey(hexStringToBuffer(privateKey)).toV3(passphrase);
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(keyStore));
  }
}

export function keyStoreFileName(address: string): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + (address.startsWith('0x') ? address.substr(2) : address);
}
