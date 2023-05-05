import { Protocol, Peer, ProtocolStream } from '@rei-network/network';
import { Node } from '../../../node';
import { NetworkProtocol } from '../../enum';
import { BaseProtocol } from '../../baseProtocol';
import { HandlerPool } from '../../handlerPool';
import { isV2 } from '../helper';
import { WireProtocolHandler } from '../handler';
import { WireProtocolHandlerV1 } from './handler';

export class WireProtocolV1 extends BaseProtocol<WireProtocolHandlerV1> implements Protocol {
  readonly pool: HandlerPool<WireProtocolHandler>;

  constructor(node: Node, pool: HandlerPool<WireProtocolHandler>) {
    super(node, NetworkProtocol.REI_ETHWIRE, '1');
    this.pool = pool;
  }

  /**
   * {@link Protocol.makeHandler}
   */
  async makeHandler(peer: Peer, stream: ProtocolStream) {
    // prefer to use the higher version of the wire protocol
    const handler = this.pool.idlePool.get(peer.peerId) ?? this.pool.busyPool.get(peer.peerId);
    if (handler && isV2(handler)) {
      return null;
    }
    return new WireProtocolHandlerV1(this, peer, stream);
  }
}
