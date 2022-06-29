import { ProtocolHandler, Protocol, Peer } from '@rei-network/network';
import { Node } from '../node';
import { NetworkProtocol } from './types';

export abstract class BaseProtocol<T extends ProtocolHandler> implements Protocol {
  readonly node: Node;
  readonly name: NetworkProtocol;
  readonly version: string;

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
   * Before make handler hook, always return true
   */
  beforeMakeHandler(peer: Peer): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Abstract make handler function
   */
  abstract makeHandler(peer: Peer): T;

  /**
   * Get the protocol handler of the peer
   * @param peer - Peer object
   */
  getHandler(peer: Peer): T;
  getHandler(peer: Peer, throwError: true): T;
  getHandler(peer: Peer, throwError: false): T | undefined;
  getHandler(peer: Peer, throwError: boolean): T | undefined;
  getHandler(peer: Peer, throwError: boolean = true) {
    if (!peer.isSupport(this.protocolString)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${this.protocolString}`);
      }
    } else {
      return peer.getMsgQueue(this.protocolString).handler as T;
    }
  }
}
