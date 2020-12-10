const Libp2p = require('libp2p');
import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';

import { constants } from '@gxchain2/common';

import { Peer } from './peer';
import { Protocol, ETHProtocol } from './protocol';

// TODO: impl this.
function parseProtocol(name: string) {
  return new ETHProtocol();
}

export class Libp2pNode extends Libp2p {
  readonly peerId: PeerId;
  private readonly peers = new Map<string, Peer>();
  private readonly protocols: Protocol[];

  constructor(peerId: PeerId, options: any) {
    super({
      peerInfo: peerId,
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/40404', '/ip4/0.0.0.0/tcp/40405/ws']
      },
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
            list: options.bootnodes ?? []
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
    this.protocols = options.protocols;
  }

  getPeer(id: string) {
    return this.peers.get(id);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peers.forEach(fn);
  }

  getPeerInfo(connection: any) {
    return new Promise<any>((resolve, reject) => {
      connection.getPeerInfo((err: any, info: any) => {
        if (err) {
          return reject(err);
        }
        resolve(info);
      });
    });
  }

  async init() {
    this.protocols.forEach((protocol) => {
      this.handle(protocol.protocolString, async ({ connection, stream, protocol }) => {
        try {
          const peerInfo = await this.getPeerInfo(connection);
          const id = peerInfo.id.toB58String();
          const peer = this.peers.get(id);
          if (peer) {
            // TODO: impl this.
            peer.acceptProtocol(stream, parseProtocol(protocol), undefined);
            this.emit('connected', peer);
          }
        } catch (e) {
          this.error(e);
        }
      });
    });
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
