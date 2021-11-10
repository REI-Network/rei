import { Protocol, Peer } from '@gxchain2/network';
import { Node } from '../../node';
import { NetworkProtocol } from '../types';
import { BaseProtocol } from '../baseProtocol';
import { HandlerPool } from '../handlerPool';
import { WireProtocolHandler } from './handler';

export class WireProtocol extends BaseProtocol<WireProtocolHandler> implements Protocol {
  readonly pool = new HandlerPool<WireProtocolHandler>();

  constructor(node: Node) {
    super(node, NetworkProtocol.GXC2_ETHWIRE, '1');
  }

  makeHandler(peer: Peer) {
    const handler = new WireProtocolHandler({
      protocol: this,
      node: this.node,
      name: this.name,
      peer
    });
    return handler;
  }
}
