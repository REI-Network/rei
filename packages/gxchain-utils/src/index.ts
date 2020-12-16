import CID from 'cids';
import multihashing from 'multihashing-async';

export const stringToCID = async (str: string) => {
  const bytes = new TextEncoder().encode(str);
  const hash = await multihashing(bytes, 'sha2-256');
  return new CID(1, 'keccak-256', hash);
};

export * from './abort';
export * from './orderedqueue';
export * from './asyncnext';
