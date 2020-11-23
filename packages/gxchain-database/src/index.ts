import { Database } from '@gxchain2/interface';

export default class DatabaseImpl implements Database {
  private fakeDatabase = new Map<string, any>();
  private localBlockHeight = 0;

  put(key: string, val: any) {
    this.fakeDatabase.set(key, val);
  }

  get(key: string) {
    return this.fakeDatabase.get(key);
  }

  forEach(fn: (value: any, key: string, map: Map<string, any>) => void) {
    this.fakeDatabase.forEach(fn);
  }

  updateLocalBlockHeight(height: number) {
    this.localBlockHeight = height;
  }

  getLocalBlockHeight() {
    return this.localBlockHeight;
  }
}
