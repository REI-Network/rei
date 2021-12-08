import { ProtocolHandler, Protocol, Peer } from '@rei-network/network';
import { Node } from '../node';
import { NetworkProtocol } from './types';

export abstract class BaseProtocol<T extends ProtocolHandler> implements Protocol {
  readonly node: Node;
  readonly name: NetworkProtocol;
  readonly version: string;

  abstract makeHandler(peer: Peer): T;

  constructor(node: Node, name: NetworkProtocol, version: string) {
    this.node = node;
    this.name = name;
    this.version = version;
  }

  /**
   * Get the protocol string
   */
  get protocolString() {
    return `/${this.name}/${this.version}`;
  }

  /**
   * Get the protocol handler of the peer
   * @param peer - Peer object
   */
  getHandler(peer: Peer): T;
  getHandler(peer: Peer, throwError: true): T;
  getHandler(peer: Peer, throwError: false): T | undefined;
  getHandler(peer: Peer, throwError: boolean): T | undefined;
  getHandler(peer: Peer, throwError: boolean = true) {
    if (!peer.isSupport(this.name)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${this.name}`);
      }
    } else {
      return peer.getMsgQueue(this.name).handler as T;
    }
  }
}
