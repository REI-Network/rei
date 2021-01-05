import levelUp from 'levelup';
import levelDown from 'leveldown';
import encoding from 'encoding-down';

export { DBManager as Database } from './db/manager';
export * from './db/helpers';

export const createLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};
