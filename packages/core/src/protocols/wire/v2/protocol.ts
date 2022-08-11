import { Protocol, Peer, ProtocolStream } from '@rei-network/network';
import { Node } from '../../../node';
import { NetworkProtocol } from '../../types';
import { BaseProtocol } from '../../baseProtocol';
import { HandlerPool } from '../../handlerPool';
import { isV1 } from '../helper';
import { WireProtocolHandler } from '../handler';
import { WireProtocolHandlerV2 } from './handler';

export class WireProtocolV2 extends BaseProtocol<WireProtocolHandlerV2> implements Protocol {
  readonly pool: HandlerPool<WireProtocolHandler>;

  constructor(node: Node, pool: HandlerPool<WireProtocolHandler>) {
    super(node, NetworkProtocol.REI_ETHWIRE, '2');
    this.pool = pool;
  }

  /**
   * {@link Protocol.makeHandler}
   */
  async makeHandler(peer: Peer, stream: ProtocolStream) {
    // prefer to use the higher version of the wire protocol
    const handler = this.pool.idlePool.get(peer.peerId) ?? this.pool.busyPool.get(peer.peerId);
    if (handler && isV1(handler)) {
      // uninstall low version
      await handler.peer.uninstallProtocol(handler.protocol.protocolString);
    }
    return new WireProtocolHandlerV2(this, peer, stream);
  }
}
