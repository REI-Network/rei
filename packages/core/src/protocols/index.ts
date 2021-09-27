import { Protocol, ProtocolHandler } from '@gxchain2/network';
import { Node } from '../node';
import { HandlerPool } from './handlerPool';
import { WireProtocolHandler, WireProtocol } from './wire';

export * from './handlerPool';
export * from './handlerBase';
export * from './wire';

export enum NetworkProtocol {
  GXC2_ETHWIRE = 'gxc2-ethwire'
}

const pools = new Map<string, HandlerPool<ProtocolHandler>>([[NetworkProtocol.GXC2_ETHWIRE, new HandlerPool<WireProtocolHandler>()]]);

/**
 * Get the pool of handler according to the name of the protocol
 * @param name Protocol name
 * @returns Protocol Pool
 */
export function getProtocolPoolByName(name: string) {
  const pool = pools.get(name);
  if (!pool) {
    throw new Error(`Unknow protocol name: ${name}`);
  }
  return pool;
}

/**
 * Create Protocols by protocal name
 * @param node Node object
 * @param names Protocol names
 * @returns Protocol objects
 */
export function createProtocolsByNames(node: Node, names: string[]): Protocol[] {
  return names.map((name) => {
    switch (name) {
      case NetworkProtocol.GXC2_ETHWIRE:
        return new WireProtocol(node);
      default:
        throw new Error(`Unknow protocol name: ${name}`);
    }
  });
}
