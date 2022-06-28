import { Protocol, Peer } from '@rei-network/network';
import { Node } from '../../../node';
import { NetworkProtocol } from '../../types';
import { BaseProtocol } from '../../baseProtocol';
import { HandlerPool } from '../../handlerPool';
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
  makeHandler(peer: Peer) {
    return new WireProtocolHandlerV2(this, peer);
  }
}
