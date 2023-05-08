import { BN } from 'ethereumjs-util';
import { Block } from '@rei-network/structure';
import { Peer } from '@rei-network/network';
import { Node } from '../../node';
import { HandlerPool } from './handlerPool';
import { WireProtocolHandler } from './handler';
import { WireProtocolV1 } from './v1';
import { WireProtocolV2 } from './v2';

export class Wire {
  readonly pool = new HandlerPool<WireProtocolHandler>();
  readonly v1: WireProtocolV1;
  readonly v2: WireProtocolV2;

  constructor(node: Node) {
    this.v1 = new WireProtocolV1(node, this.pool);
    this.v2 = new WireProtocolV2(node, this.pool);
  }

  /**
   * Get the protocol handler of the peer
   * @param peer - Peer object
   */
  getHandler(peer: Peer): WireProtocolHandler;
  getHandler(peer: Peer, throwError: true): WireProtocolHandler;
  getHandler(peer: Peer, throwError: false): WireProtocolHandler | undefined;
  getHandler(peer: Peer, throwError: boolean): WireProtocolHandler | undefined;
  getHandler(peer: Peer, throwError: boolean = true) {
    if (!peer.isSupport(this.v1.protocolString) && !peer.isSupport(this.v2.protocolString)) {
      if (throwError) {
        throw new Error(`peer doesn't support ${this.v1.protocolString} and ${this.v2.protocolString}`);
      }
    } else if (peer.isSupport(this.v1.protocolString)) {
      return peer.getHandler(this.v1.protocolString) as WireProtocolHandler;
    } else {
      return peer.getHandler(this.v2.protocolString) as WireProtocolHandler;
    }
  }

  /**
   * Broadcast new block to all connected peers
   * @param block - Block
   */
  async broadcastNewBlock(block: Block, td: BN) {
    for (const handler of this.pool.handlers) {
      handler.announceNewBlock(block, td);
    }
  }
}
