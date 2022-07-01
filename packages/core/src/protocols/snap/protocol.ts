import { Protocol, Peer } from '@rei-network/network';
import { Node } from '../../node';
import { NetworkProtocol } from '../types';
import { BaseProtocol } from '../baseProtocol';
import { SnapHandlerPool } from './snapHandlerPool';
import { SnapProtocolHandler } from './handler';

export class SnapProtocol extends BaseProtocol<SnapProtocolHandler> implements Protocol {
  readonly pool = new SnapHandlerPool();

  constructor(node: Node) {
    super(node, NetworkProtocol.REI_SNAP, '1');
  }

  /**
   *
   * {@link Protocol.makeHandler}
   */
  makeHandler(peer: Peer) {
    return new SnapProtocolHandler(this, peer);
  }
}
