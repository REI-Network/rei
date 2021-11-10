import { Protocol, Peer } from '@gxchain2/network';
import { Node } from '../../node';
import { NetworkProtocol } from '../types';
import { BaseProtocol } from '../baseProtocol';
import { ConsensusProtocolHander } from './handler';

export class ConsensusProtocol extends BaseProtocol<ConsensusProtocolHander> implements Protocol {
  private _handlers = new Set<ConsensusProtocolHander>();

  constructor(node: Node) {
    super(node, NetworkProtocol.GXC2_CONSENSUS, '1');
  }

  get handlers() {
    return Array.from(this._handlers);
  }

  addHandler(handler: ConsensusProtocolHander) {
    this._handlers.add(handler);
  }

  removeHandler(handler: ConsensusProtocolHander) {
    this._handlers.delete(handler);
  }

  makeHandler(peer: Peer) {
    const handler = new ConsensusProtocolHander({
      protocol: this,
      node: this.node,
      name: this.name,
      peer
    });
    return handler;
  }
}
