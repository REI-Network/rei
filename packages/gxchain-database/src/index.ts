import levelUp from 'levelup';
import levelDown from 'leveldown';
import encoding from 'encoding-down';

export { Database } from './db/manager';
export * from './db/helpers';
export { DBTarget } from './db/operation';

export const createLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};
