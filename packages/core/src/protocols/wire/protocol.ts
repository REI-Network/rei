import { Protocol, Peer } from '@gxchain2/network';
import { Node } from '../../node';
import { NetworkProtocol, getProtocolPoolByName, HandlerPool } from '../index';
import { WireProtocolHandler } from './handler';

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

  /**
   * Get the protocol string
   */
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
    return getProtocolPoolByName(NetworkProtocol.GXC2_ETHWIRE) as HandlerPool<WireProtocolHandler>;
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
