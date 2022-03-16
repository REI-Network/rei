import { Database, DBOp } from '@rei-network/database';

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

  write() {
    return this.length > 0 ? this.db.batch(this.batch) : Promise.resolve();
  }

  reset() {
    this.batch = [];
  }
}
