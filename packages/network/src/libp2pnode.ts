import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import { Discv5Discovery, ENR } from '@gxchain2/discv5';
const Libp2p = require('libp2p');

export interface Libp2pNodeOptions {
  peerId: PeerId;
  enr: ENR;
  tcpPort: number;
  udpPort: number;
  maxConnections: number;
  bootnodes: string[];
  datastore?: any;
}

export class Libp2pNode extends Libp2p {
  constructor(options: Libp2pNodeOptions) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${options.tcpPort}`]
      },
      modules: {
        transport: [TCP],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: [Discv5Discovery]
      },
      config: {
        peerDiscovery: {
          autoDial: false,
          discv5: {
            enr: options.enr,
            bindAddr: `/ip4/0.0.0.0/udp/${options.udpPort}`,
            bootEnrs: options.bootnodes || []
          }
        }
      },
      connectionManager: {
        maxConnections: options.maxConnections,
        minConnections: 0
      },
      dialer: {
        dialTimeout: 5e3
      },
      datastore: options.datastore,
      peerStore: {
        persistence: !!options.datastore,
        threshold: 0
      }
    });
  }
}
