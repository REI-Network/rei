import { Database, Common } from '@gxchain2/interface';

import levelUp from 'levelup';
import levelDown from 'leveldown';
import type { LevelUp } from 'levelup';
import { DBManager } from '@ethereumjs/blockchain/dist/db/manager';
import { DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups } from '@ethereumjs/blockchain/dist/db/helpers';
import { DBTarget } from '@ethereumjs/blockchain/dist/db/operation';

class DatabaseImpl extends DBManager implements Database {
  constructor(db: LevelUp, common: Common) {
    super(db, common as any);
  }
}

const levelDB = levelUp(levelDown('./gxchaindb'));

export { DatabaseImpl, levelDB, DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups, DBTarget };
