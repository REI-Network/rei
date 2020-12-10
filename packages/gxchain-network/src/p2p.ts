const Libp2p = require('libp2p');
import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';

import { constants } from '@gxchain2/common';

import Peer from './peer';

export default class Libp2pNode extends Libp2p {
  private peerId: PeerId | undefined;
  private peerInfoMap = new Map<string, Peer>();

  constructor(peerId: PeerId) {
    super({
      peerInfo: peerId,
      modules: {
        transport: [TCP, WebSockets],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: [Bootstrap],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: []
          }
        },
        dht: {
          kBucketSize: 20
        },
        EXPERIMENTAL: {
          dht: false,
          pubsub: false
        }
      }
    });

    this.peerId = peerId;
  }

  getPeer(id: string) {
    return this.peerInfoMap.get(id);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peerInfoMap.forEach(fn);
  }

  getLocalPeerId() {
    return this.peerId!.toB58String();
  }

  async init() {
    this.on('peer:discovery', (peer) => {});

    this.on('error', (err) => {});

    this.on('peer:connect', (connection) => {});

    // Handle messages for the protocol
    await this.handle(constants.JSONRPCProtocol, ({ connection, stream, protocol }) => {});

    // start libp2p
    await this.start();
    console.log('Libp2p has started', this.peerId!.toB58String());
    this.multiaddrs.forEach((ma) => {
      console.log(ma.toString() + '/p2p/' + this.peerId!.toB58String());
    });
  }
}
