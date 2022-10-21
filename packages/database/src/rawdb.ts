import levelup, { LevelUp } from 'levelup';
import encoding from 'encoding-down';
import { leveldown } from '@rei-network/binding';

export const createEncodingLevelDB = (path: string): [LevelUp, any] => {
  const down = leveldown(path);
  return [levelup(encoding(down), { manifestFileMaxSize: 64 * 1024 * 1024 }), down];
};

export const createLevelDB = (path: string): [LevelUp, any] => {
  const down: any = leveldown(path);
  return [levelup(down, { manifestFileMaxSize: 64 * 1024 * 1024 }), down];
};
