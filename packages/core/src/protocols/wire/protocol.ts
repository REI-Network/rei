import { Protocol, Peer } from '@rei-network/network';
import { Block } from '@rei-network/structure';
import { Node } from '../../node';
import { NetworkProtocol } from '../types';
import { BaseProtocol } from '../baseProtocol';
import { HandlerPool } from '../handlerPool';
import { WireProtocolHandler } from './handler';

export class WireProtocol extends BaseProtocol<WireProtocolHandler> implements Protocol {
  readonly pool = new HandlerPool<WireProtocolHandler>();

  constructor(node: Node) {
    super(node, NetworkProtocol.REI_ETHWIRE, '1');
  }

  /**
   * {@link Protocol.makeHandler}
   */
  makeHandler(peer: Peer) {
    return new WireProtocolHandler(this, peer);
  }

  /**
   * Broadcast new block to all connected peers
   * @param block - Block
   */
  async broadcastNewBlock(block: Block) {
    const td = await this.node.db.getTotalDifficulty(block.hash(), block.header.number);
    for (const handler of this.pool.handlers) {
      handler.announceNewBlock(block, td);
    }
  }
}
