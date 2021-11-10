import { Peer, Protocol } from '@gxchain2/network';
import { Node } from '../node';
import { WireProtocol } from './wire';
import { ConsensusProtocol } from './consensus';

export enum NetworkProtocol {
  GXC2_ETHWIRE = 'gxc2-ethwire',
  GXC2_CONSENSUS = 'gxc2-consensus'
}

export class PeerRequestTimeoutError extends Error {}

export type HandlerFunc = {
  name: string;
  code: number;
  response?: number;
  encode(data: any): any;
  decode(data: any): any;
  process?: (data: any) => Promise<[string, any]> | Promise<[string, any] | void> | [string, any] | void;
};

export interface BaseHandlerOptions<T extends Protocol> {
  node: Node;
  protocol: T;
  name: string;
  peer: Peer;
  handlerFuncs: HandlerFunc[];
}

/**
 * Create Protocol by protocol name
 * @param node Node object
 * @param name Protocol name
 * @returns Protocol objects
 */
export function createProtocolByName(node: Node, name: string): Protocol {
  switch (name) {
    case NetworkProtocol.GXC2_ETHWIRE:
      return new WireProtocol(node);
    case NetworkProtocol.GXC2_CONSENSUS:
      return new ConsensusProtocol(node);
    default:
      throw new Error(`Unknow protocol name: ${name}`);
  }
}
