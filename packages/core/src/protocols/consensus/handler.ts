import { rlp } from 'ethereumjs-util';
import { HandlerBase, HandlerFunc, HandlerBaseOptions } from '../handlerBase';
import { ConsensusProtocol } from './protocol';

const consensusHandlerFuncs: HandlerFunc[] = [];

export interface ConsensusProtocolHanderOptions extends Omit<HandlerBaseOptions, 'handlerFuncs'> {}

export class ConsensusProtocolHander extends HandlerBase<any> {
  protected onHandshakeSucceed() {
    ConsensusProtocol.getPool().add(this);
  }
  protected onHandshake() {}
  protected onHandshakeResponse(status: any) {
    return true;
  }
  protected onAbort() {
    ConsensusProtocol.getPool().remove(this);
  }

  protected encode(method: string | number, data: any) {
    return rlp.encode(this.findHandler(method).encode.call(this, data));
  }
  protected decode(data: Buffer) {
    return rlp.decode(data) as unknown as [number, any];
  }

  constructor(options: ConsensusProtocolHanderOptions) {
    super({ ...options, handlerFuncs: consensusHandlerFuncs });
  }
}
