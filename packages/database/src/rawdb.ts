import levelup from 'levelup';
import encoding from 'encoding-down';
import { leveldown } from '@rei-network/binding';

export const createEncodingLevelDB = (path: string) => {
  return levelup(encoding(leveldown(path)), { manifestFileMaxSize: 64 * 1024 * 1024 });
};

export const createLevelDB = (path: string) => {
  return levelup(leveldown(path) as any, { manifestFileMaxSize: 64 * 1024 * 1024 });
};
