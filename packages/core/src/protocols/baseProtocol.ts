import {
  ProtocolHandler,
  Protocol,
  Peer,
  ProtocolStream
} from '@rei-network/network';
import { Node } from '../node';
import { NetworkProtocol } from './enum';

export abstract class BaseProtocol<T extends ProtocolHandler>
  implements Protocol
{
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
   * Abstract make handler function
   */
  abstract makeHandler(peer: Peer, stream: ProtocolStream): Promise<T | null>;

  /**
   * Get the protocol handler of the peer
   * @param peer - Peer object
   */
  getHandler(peer: Peer): T;
  getHandler(peer: Peer, throwError: true): T;
  getHandler(peer: Peer, throwError: false): T | undefined;
  getHandler(peer: Peer, throwError: boolean): T | undefined;
  getHandler(peer: Peer, throwError = true) {
    if (!peer.isSupport(this.protocolString)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${this.protocolString}`);
      }
    } else {
      return peer.getHandler(this.protocolString) as T;
    }
  }
}
