import fs from 'fs';
import path from 'path';
import { Address } from 'ethereumjs-util';
import { decrypt, encrypt } from './account';

export class KeyStore {
  keyDirPath: string;
  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  getKey(addr: Address, filename: string, auth: string) {
    const keyjson = JSON.parse(fs.readFileSync(filename).toString());
    const key = decrypt(keyjson, auth);
    if (key.address.toLowerCase() != addr.toString()) {
      throw new Error('key content mismatch');
    }
    return key;
  }

  joinPath(filename: string): string {
    return path.isAbsolute(filename) ? filename : path.join(this.keyDirPath, filename);
  }

  storeKey(filename: string, key: { address: string; privateKey: string }, auth: string) {
    const keyjson = encrypt(key.privateKey, auth);
    fs.mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    return fs.writeFileSync(filename, JSON.stringify(keyjson));
  }
}
