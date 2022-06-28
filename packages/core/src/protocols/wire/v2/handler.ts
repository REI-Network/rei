import { Peer } from '@rei-network/network';
import { WireProtocolHandler, WireProtocol } from '../handler';
import { wireHandlerBaseFuncs } from '../wireFunctions';

const wireHandlerFuncsV2 = wireHandlerBaseFuncs;

export class WireProtocolHandlerV2 extends WireProtocolHandler {
  constructor(protocol: WireProtocol, peer: Peer) {
    super(protocol, peer, wireHandlerFuncsV2);
  }
}
