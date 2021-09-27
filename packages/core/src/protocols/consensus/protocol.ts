import { Protocol, Peer } from '@gxchain2/network';
import { Node } from '../../node';
import { NetworkProtocol, getProtocolPoolByName, HandlerPool } from '../index';
import { ConsensusProtocolHander } from './handler';

export class ConsensusProtocol implements Protocol {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  /**
   * Get the protocol name
   */
  get name() {
    return NetworkProtocol.GXC2_CONSENSUS;
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
    const handler = new ConsensusProtocolHander({
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
    return getProtocolPoolByName(NetworkProtocol.GXC2_CONSENSUS) as HandlerPool<ConsensusProtocolHander>;
  }

  /**
   * Get the protocol handler of the peer
   * @param peer Peer object
   */
  static getHandler(peer: Peer): ConsensusProtocolHander;
  static getHandler(peer: Peer, throwError: true): ConsensusProtocolHander;
  static getHandler(peer: Peer, throwError: false): ConsensusProtocolHander | undefined;
  static getHandler(peer: Peer, throwError: boolean): ConsensusProtocolHander | undefined;
  static getHandler(peer: Peer, throwError: boolean = true) {
    if (!peer.isSupport(NetworkProtocol.GXC2_CONSENSUS)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${NetworkProtocol.GXC2_CONSENSUS}`);
      }
    } else {
      return peer.getMsgQueue(NetworkProtocol.GXC2_CONSENSUS).handler as ConsensusProtocolHander;
    }
  }
}
