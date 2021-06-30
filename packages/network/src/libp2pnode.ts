import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';
const Libp2p = require('libp2p');

export interface Libp2pNodeOptions {
  peerId: PeerId;
  datastore?: any;
  tcpPort?: number;
  wsPort?: number;
  bootnodes?: string[];
}

export class Libp2pNode extends Libp2p {
  constructor(options: Libp2pNodeOptions) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${options.tcpPort || 0}`, `/ip4/0.0.0.0/tcp/${options.wsPort || 0}/ws`]
      },
      modules: {
        transport: [TCP, WebSockets],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: options.bootnodes !== undefined ? [Bootstrap] : [],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          autoDial: true,
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: options.bootnodes || []
          }
        },
        dht: {
          kBucketSize: 20,
          enabled: true,
          randomWalk: {
            enabled: false,
            interval: 3e3,
            timeout: 10e3
          }
        },
        EXPERIMENTAL: {
          dht: false,
          pubsub: false
        }
      },
      connectionManager: {
        maxConnections: 2,
        minConnections: 2
      },
      datastore: options.datastore,
      peerStore: {
        persistence: !!options.datastore,
        threshold: 0
      }
    });
  }
}
