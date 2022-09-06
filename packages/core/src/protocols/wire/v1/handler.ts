import { Peer, ProtocolStream } from '@rei-network/network';
import { WireProtocolHandler, WireProtocol } from '../handler';
import { wireHandlerBaseFuncs } from '../wireFunctions';

const wireHandlerFuncsV1 = wireHandlerBaseFuncs;

export class WireProtocolHandlerV1 extends WireProtocolHandler {
  constructor(protocol: WireProtocol, peer: Peer, stream: ProtocolStream) {
    super(protocol, peer, stream, wireHandlerFuncsV1);
  }
}
