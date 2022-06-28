import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import { Discv5Discovery, ENR, KademliaRoutingTable, SessionService } from '@gxchain2/discv5';
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

/**
 * `libp2p` node
 */
export class Libp2pNode extends Libp2p {
  constructor(options: Libp2pNodeOptions) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${options.tcpPort}`],
        noAnnounce: [`/ip4/127.0.0.1/tcp/${options.tcpPort}`]
      },
      modules: {
        transport: [TCP],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: [Discv5Discovery]
      },
      config: {
        relay: {
          enabled: false
        },
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
      peerStore: {
        threshold: 0
      }
    });
  }

  /**
   * Only can get value after libp2p has been started
   */
  get discv5(): Discv5Discovery {
    return this._discovery.get(Discv5Discovery.tag);
  }

  get kbuckets(): KademliaRoutingTable {
    return (this.discv5 as any).kbuckets;
  }

  get sessionService(): SessionService {
    return (this.discv5 as any).sessionService;
  }
}
