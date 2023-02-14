import { Bls } from './types';

let bls!: Bls;

export function importBls() {
  return bls;
}

export async function initBls() {
  bls = (await import('@chainsafe/bls')).default;
}
