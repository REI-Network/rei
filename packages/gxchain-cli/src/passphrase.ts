import { Address } from 'ethereumjs-util';
import fs from 'fs';
import path from 'path';

const Accounts = require('web3-eth-accounts');
const web3accounts = new Accounts();

export class KeyStorePassphrase {
  keyDirPath: string;
  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  getkey(addr: Address, filename: string, auth: string) {
    const keybuffer = fs.readFileSync(filename);
    const keyjson = JSON.parse(keybuffer.toString());
    const key = web3accounts.decrypt(keyjson, auth);
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

  storekey(filename: string, key: any, auth: string) {
    const keyjson = web3accounts.encrypt(key.privateKey, auth);
    fs.mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    const tmpname = path.join(path.dirname(filename), path.basename(filename) + '.tmp');
    fs.writeFileSync(tmpname, Buffer.from(JSON.stringify(keyjson)));
    try {
      this.getkey(Address.fromString(key.address), tmpname, auth);
    } catch (err) {
      console.log('can not store the key ');
      return;
    }
    return fs.renameSync(tmpname, filename);
  }
}
