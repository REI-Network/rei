import fs from 'fs';
import path from 'path';
import { decrypt, encrypt, cryptoStruct } from './utils';

export class KeyStore {
  private keyDirPath: string;

  constructor(keydir: string) {
    this.keyDirPath = keydir;
  }

  async getKey(path: string, passphrase: string, pubKey?: string) {
    const {
      default: { SecretKey }
    }: any = await import('@chainsafe/bls');
    const secretKey = decrypt(JSON.parse(fs.readFileSync(path, 'utf-8')), passphrase);
    const key = SecretKey.fromHex(secretKey);
    if (pubKey && key.toPublicKey().toHex() !== pubKey) {
      throw new Error('Invalid passphrase');
    }
    return key;
  }

  joinPath(filename: string): string {
    return path.isAbsolute(filename) ? filename : path.join(this.keyDirPath, filename);
  }

  async storeKey(fullPath: string, secretKey: string, passphrase: string) {
    const secretStruct = encrypt(secretKey, passphrase);
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(secretStruct));
  }
}

export function signerFileName(signerPukey: string): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + (signerPukey.startsWith('0x') ? signerPukey.substr(2) : signerPukey);
}
