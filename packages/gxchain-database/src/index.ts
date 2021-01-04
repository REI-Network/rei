import levelUp from 'levelup';
import levelDown from 'leveldown';
import type { LevelUp } from 'levelup';
import encoding from 'encoding-down';
import { DBManager } from '@ethereumjs/blockchain/dist/db/manager';
export { DBOp, DBSetBlockOrHeader, DBSetTD, DBSetHashToNumber, DBSaveLookups } from '@ethereumjs/blockchain/dist/db/helpers';

import type { Common } from '@gxchain2/common';

export class Database extends DBManager {
  constructor(db: LevelUp, common: Common) {
    super(db, common);
  }
}

export const createLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};
