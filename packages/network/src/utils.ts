import { getRandomIntInclusive } from '@rei-network/utils';

export function randomOne<T>(array: T[]) {
  if (array.length === 1) {
    return array[0];
  } else if (array.length === 0) {
    throw new Error('empty array');
  }
  return array[getRandomIntInclusive(0, array.length - 1)];
}
