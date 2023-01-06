import path from 'path';
import { KeyStore } from './sigerStore';

export class SignerManager {
  private storage: KeyStore;

  constructor(keydir: string) {
    if (!path.isAbsolute(keydir)) {
      keydir = path.join(process.cwd(), keydir);
    }
    this.storage = new KeyStore(keydir);
  }
}
