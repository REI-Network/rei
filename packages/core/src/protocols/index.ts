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

export function getProtocolPoolByName(name: string) {
  const pool = pools.get(name);
  if (!pool) {
    throw new Error(`Unknow protocol name: ${name}`);
  }
  return pool;
}

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

  get name() {
    return NetworkProtocol.GXC2_ETHWIRE;
  }

  get protocolString() {
    return `/${this.name}/1`;
  }

  makeHandler(peer: Peer) {
    const pool = WireProtocol.getPool();
    const handler = new WireProtocolHandler({
      node: this.node,
      name: this.name,
      peer,
      onDestroy: () => {
        pool.remove(handler);
      }
    });
    pool.add(handler);
    return handler;
  }

  static getPool() {
    return getProtocolPoolByName(NetworkProtocol.GXC2_ETHWIRE) as ProtocolPool<WireProtocolHandler>;
  }

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
