import { Address } from 'ethereumjs-util';
import fs from 'fs';
import path from 'path';
import { decrypt, encrypt } from './account';

export class KeyStorePassphrase {
  keyDirPath: string;
  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  getkey(addr: Address, filename: string, auth: string) {
    const keybuffer = fs.readFileSync(filename);
    if (!keybuffer) {
      throw new Error('Can not read the files');
    }
    const keyjson = JSON.parse(keybuffer.toString());
    const key = decrypt(keyjson, auth);
    if (key.address.toLowerCase() != addr.toString()) {
      throw new Error('key content mismatch');
    }
    return key;
  }

  joinPath(filename: string): string {
    if (path.isAbsolute(filename)) {
      return filename;
    }
    return path.join(this.keyDirPath, filename);
  }

  storekey(filename: string, key: { address: string; privateKey: string }, auth: string) {
    const keyjson = encrypt(key.privateKey, auth);
    fs.mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    return fs.writeFileSync(filename, JSON.stringify(keyjson));
  }
}
