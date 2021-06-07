import fs from 'fs';
import path from 'path';
import { decrypt, encrypt } from './account';

export class KeyStore {
  private keyDirPath: string;

  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  getKey(path: string, auth: string, address?: string): { address: string; privateKey: string } {
    const keyjson = JSON.parse(fs.readFileSync(path).toString());
    const key: { address: string; privateKey: string } = decrypt(keyjson, auth);
    if (address && key.address.toLowerCase() !== address) {
      throw new Error('key content mismatch');
    }
    return key;
  }

  joinPath(filename: string): string {
    return path.isAbsolute(filename) ? filename : path.join(this.keyDirPath, filename);
  }

  storeKey(fullPath: string, privateKey: string, auth: string) {
    const keyjson = encrypt(privateKey, auth);
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(keyjson));
  }
}

export function keyStoreFileName(address: string): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + address;
}
