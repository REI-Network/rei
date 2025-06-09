import { LevelUp } from 'levelup';
import { Database, DBOp, DBOpData } from '@rei-network/database';

export class DBatch {
  private readonly db: Database;
  private batch: DBOp[] = [];

  constructor(db: Database) {
    this.db = db;
  }

  get length() {
    return this.batch.length;
  }

  push(op: DBOp) {
    this.batch.push(op);
  }

  async write(reset = true) {
    try {
      if (this.length > 0) {
        await this.db.batch(this.batch);
      }
    } finally {
      if (reset) {
        this.batch = [];
      }
    }
  }
}

export class BinaryRawDBatch {
  private readonly db: LevelUp;
  private batch: DBOpData[] = [];

  constructor(db: LevelUp) {
    this.db = db;
  }

  get length() {
    return this.batch.length;
  }

  push(op: Omit<DBOpData, 'keyEncoding' | 'valueEncoding'>) {
    this.batch.push({
      ...op,
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    });
  }

  async write(reset = true) {
    try {
      if (this.length > 0) {
        await this.db.batch(this.batch as any);
      }
    } finally {
      if (reset) {
        this.batch = [];
      }
    }
  }
}
