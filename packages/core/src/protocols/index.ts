import { Protocol, Peer, ProtocolHandler } from '@gxchain2/network';
import { Node } from '../node';
import { ProtocolPool } from './protocolpool';
import { WireProtocolHandler } from './wireprotocol';

export * from './protocolpool';
export * from './wireprotocol';

export enum NetworkProtocol {
  GXC2_ETHWIRE = 'gxc2-ethwire'
}

const pools = new Map<string, ProtocolPool<ProtocolHandler>>([[NetworkProtocol.GXC2_ETHWIRE, new ProtocolPool<WireProtocolHandler>()]]);

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

export class WireProtocol implements Protocol {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  /**
   * Get the protocol name
   */
  get name() {
    return NetworkProtocol.GXC2_ETHWIRE;
  }

  get protocolString() {
    return `/${this.name}/1`;
  }

  /**
   * Create protocol handler for peer
   * @param peer Peer object
   * @returns Handler object
   */
  makeHandler(peer: Peer) {
    const handler = new WireProtocolHandler({
      node: this.node,
      name: this.name,
      peer
    });
    return handler;
  }

  /**
   * Get ProtocolHandler pool
   * @returns Protocol pool
   */
  static getPool() {
    return getProtocolPoolByName(NetworkProtocol.GXC2_ETHWIRE) as ProtocolPool<WireProtocolHandler>;
  }

  /**
   * Get the protocol handler of the peer
   * @param peer Peer object
   */
  static getHandler(peer: Peer): WireProtocolHandler;
  static getHandler(peer: Peer, throwError: true): WireProtocolHandler;
  static getHandler(peer: Peer, throwError: false): WireProtocolHandler | undefined;
  static getHandler(peer: Peer, throwError: boolean): WireProtocolHandler | undefined;
  static getHandler(peer: Peer, throwError: boolean = true) {
    if (!peer.isSupport(NetworkProtocol.GXC2_ETHWIRE)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${NetworkProtocol.GXC2_ETHWIRE}`);
      }
    } else {
      return peer.getMsgQueue(NetworkProtocol.GXC2_ETHWIRE).handler as WireProtocolHandler;
    }
  }
}
