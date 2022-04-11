import { Nibbles } from 'merkle-patricia-tree/dist/trieNode';

export type TransportNibbles = Nibbles;

export function nibblesToTransportNibbles(key: Nibbles) {
  key = [...key];

  // odd
  if (key.length % 2) {
    key.unshift(1);
  } else {
    // even
    key.unshift(0);
    key.unshift(0);
  }

  return key;
}

export function transportNibblesToNibbles(key: TransportNibbles) {
  if (key[0] % 2) {
    key = key.slice(1);
  } else {
    key = key.slice(2);
  }

  return key;
}
