import { Protocol, Peer } from '@rei-network/network';
import { Node } from '../../../node';
import { NetworkProtocol } from '../../types';
import { BaseProtocol } from '../../baseProtocol';
import { HandlerPool } from '../../handlerPool';
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
  makeHandler(peer: Peer) {
    return new WireProtocolHandlerV1(this, peer);
  }
}
