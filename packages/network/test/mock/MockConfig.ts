import PeerId from 'peer-id';
import { ENR } from '@gxchain2/discv5';

export const localhost = '127.0.0.1';
export const defaultUdpPort = 3030;
export const defaultTcpPort = 2301;

export type MockLibp2pConfig = {
  peerId: PeerId;
  maxPeers?: number;
  tcpPort?: number;
  udpPort?: number;
  enr: ENR;
};

export type MockDiscv5Config = {
  lookupInterval: number;
  keepAliveInterval: number;
};
