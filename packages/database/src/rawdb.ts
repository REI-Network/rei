import levelUp from 'levelup';
import encoding from 'encoding-down';
import { leveldown } from '@rei-network/binding';

export const createEncodingLevelDB = (path: string) => {
  return levelUp(encoding(leveldown(path), { manifestFileMaxSize: 64 * 1024 * 1024 }));
};

export const createLevelDB = (path: string) => {
  return levelUp(leveldown(path) as any, { manifestFileMaxSize: 64 * 1024 * 1024 });
};
