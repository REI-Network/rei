import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Accounts } from 'web3-eth-accounts';
import fs from 'fs';
import path from 'path';
import { fileSync } from 'tmp';

const web3accounts = new Accounts();

export class keyStorePassphrase {
  keyDirPath: string;
  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  getKey(filename: string, auth: string) {
    const keybuffer = fs.readFileSync(filename);
    const keyjson = JSON.parse(keybuffer.toString());
    const key = web3accounts.decrypt(keyjson, auth);
    return key;
  }

  joinPath(filename: string): string {
    if (path.isAbsolute(filename)) {
      return filename;
    }
    return path.join(this.keyDirPath, filename);
  }

  storeKey(filename: string, key: any, auth: string) {
    const keyjson = web3accounts.encrypt(key.privateKey, auth);
    const tmpname = this.writeTemporaryKeyFile(filename, Buffer.from(JSON.stringify(keyjson)));
    return fs.renameSync(tmpname, filename);
  }

  private writeTemporaryKeyFile(file: string, content: Buffer): string {
    fs.mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
    const tmpfile = fileSync({ tmpdir: path.dirname(file), name: '.' + path.basename(file) + '.tmp', keep: false });
    fs.writeFileSync(tmpfile.name, content);
    return tmpfile.name;
  }
}
