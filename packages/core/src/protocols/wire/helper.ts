import { WireProtocolHandlerV1 } from './v1';
import { WireProtocolHandlerV2 } from './v2';
import { WireProtocolHandler } from './handler';

export function isV1(handler: WireProtocolHandler): handler is WireProtocolHandlerV1 {
  if (handler instanceof WireProtocolHandlerV1) {
    return true;
  }
  return false;
}

export function isV2(handler: WireProtocolHandler): handler is WireProtocolHandlerV2 {
  if (handler instanceof WireProtocolHandlerV2) {
    return true;
  }
  return false;
}
