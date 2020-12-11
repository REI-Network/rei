import levelUp from 'levelup';
import levelDown from 'leveldown';
import type { LevelUp } from 'levelup';
import encoding from 'encoding-down';
import { DBManager } from '@ethereumjs/blockchain/dist/db/manager';
import { DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups } from '@ethereumjs/blockchain/dist/db/helpers';
import { DBTarget } from '@ethereumjs/blockchain/dist/db/operation';

import type { Common } from '@gxchain2/common';

class Database extends DBManager {
  constructor(db: LevelUp, common: Common) {
    super(db, common);
  }
}

const createLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};

export { Database, createLevelDB, DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups, DBTarget };
