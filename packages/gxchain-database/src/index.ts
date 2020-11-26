import levelUp from 'levelup';
import levelDown from 'leveldown';
import type { LevelUp } from 'levelup';
import { DBManager } from '@ethereumjs/blockchain/dist/db/manager';
import { DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups } from '@ethereumjs/blockchain/dist/db/helpers';
import { DBTarget } from '@ethereumjs/blockchain/dist/db/operation';

import { Database } from '@gxchain2/interface';

import type { CommonImpl } from '@gxchain2/common';

class DatabaseImpl extends DBManager implements Database {
  constructor(db: LevelUp, common: CommonImpl) {
    super(db, common as any);
  }
}

const createLevelDB = (path: string) => {
  return levelUp(levelDown(path));
};

export { DatabaseImpl, createLevelDB, DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups, DBTarget };
