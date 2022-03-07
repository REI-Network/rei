import levelUp from 'levelup';
import levelDown from 'leveldown';
import encoding from 'encoding-down';

export const createEncodingLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};

export const createLevelDB = (path: string) => {
  return levelUp(levelDown(path));
};
