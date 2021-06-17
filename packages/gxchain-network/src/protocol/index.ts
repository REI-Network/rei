import { constants } from '@gxchain2/common';
import { Protocol } from './protocol';
import { ETHProtocol } from './ethprotocol';

export function makeProtocol(name: string): Protocol {
  if (name === constants.GXC2_ETHWIRE) {
    return new ETHProtocol();
  }
  throw new Error(`Unkonw protocol: ${name}`);
}

export * from './protocol';
export * from './ethprotocol';
