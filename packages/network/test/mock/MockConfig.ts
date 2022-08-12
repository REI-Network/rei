import PeerId from 'peer-id';
import { ENR, IKeypair } from '@gxchain2/discv5';

export const localhost = '127.0.0.1';
export const defaultUdpPort = 3030;
export const defaultTcpPort = 2301;

export type MockLibp2pConfig = {
  peerId: PeerId;
  enr: ENR;
  maxPeers?: number;
  tcpPort?: number;
  udpPort?: number;
  inboundThrottleTime?: number;
  outboundThrottleTime?: number;
};

export type MockDiscv5Config = {
  keypair: IKeypair;
  enr: ENR;
  bootNodes?: string[];
  lookupInterval?: number;
  keepAliveInterval?: number;
};
