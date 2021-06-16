import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';
import { logger } from '@gxchain2/utils';
import { Peer } from './peer';
import { INode } from './types';
const Libp2p = require('libp2p');

export interface Libp2pNodeOptions {
  node: INode;
  peerId: PeerId;
  protocols: string[];
  datastore: any;
  tcpPort?: number;
  wsPort?: number;
  bootnodes?: string[];
}

export declare interface Libp2pNode {
  on(event: 'connected' | 'disconnected', listener: (peer: Peer) => void);
  on(event: 'error', listener: (err: Error) => void);

  once(event: 'connected' | 'disconnected', listener: (peer: Peer) => void);
  once(event: 'error', listener: (err: Error) => void);
}

export class Libp2pNode extends Libp2p {
  readonly node: INode;
  private readonly peers = new Map<string, Peer>();
  private readonly protocols: string[];
  private readonly banned = new Map<string, number>();

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
            enabled: true,
            interval: 3e3,
            timeout: 10e3
          }
        },
        EXPERIMENTAL: {
          dht: false,
          pubsub: false
        }
      },
      datastore: options.datastore,
      peerStore: {
        persistence: true,
        threshold: 0
      }
    });

    this.node = options.node;
    this.protocols = options.protocols;
  }

  getPeer(peerId: string) {
    return this.peers.get(peerId);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peers.forEach(fn);
  }

  private createPeer(peerInfo: PeerId) {
    const peer = new Peer({ peerId: peerInfo.toB58String(), libp2pNode: this });
    this.peers.set(peer.peerId, peer);
    return peer;
  }

  async removePeer(peerId: string | Peer) {
    const peer = typeof peerId === 'string' ? this.peers.get(peerId) : peerId;
    if (peer) {
      this.peers.delete(peer.peerId);
      this.emit('disconnected', peer);
      await peer.abort();
    }
  }

  async init() {
    this.protocols.forEach((protocol) => {
      this.handle(protocol, async ({ connection, stream }) => {
        try {
          const peerId: PeerId = connection.remotePeer;
          const id = peerId.toB58String();
          const peer = this.peers.get(id);
          if (peer && (await peer.acceptProtocol(stream, protocol, this.node.status))) {
            logger.info('💬 Peer handled:', peer.peerId);
            this.emit('connected', peer);
          }
        } catch (err) {
          this.emit('error', err);
        }
      });
    });
    super.on('peer:discovery', async (peerId: PeerId) => {
      const id = peerId.toB58String();
      try {
        if (this.peers.get(id) || this.isBanned(id)) {
          return;
        }
        const peer = this.createPeer(peerId);
        const results = await Promise.all(this.protocols.map((protocol) => peer.installProtocol(peerId, protocol, this.node.status)));
        if (results.reduce((a, b) => a || b, false)) {
          logger.info('💬 Peer discovered:', peer.peerId);
          this.emit('connected', peer);
        }
      } catch (err) {
        await this.removePeer(id);
        this.emit('error', err);
      }
    });
    this.connectionManager.on('peer:connect', (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        if (!this.peers.get(id)) {
          this.createPeer(connect.remotePeer);
          logger.info('💬 Peer connected:', id);
        }
      } catch (err) {
        this.emit('error', err);
      }
    });
    this.connectionManager.on('peer:disconnect', async (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        await this.removePeer(id);
        logger.info('🤐 Peer disconnected:', id);
      } catch (err) {
        this.emit('error', err);
      }
    });

    // start libp2p
    await this.start();
    logger.info('Libp2p has started', this.peerId!.toB58String());
    this.multiaddrs.forEach((ma) => {
      logger.info(ma.toString() + '/p2p/' + this.peerId!.toB58String());
    });
  }

  ban(peerId: string, maxAge = 60000): boolean {
    if (!this.started) {
      return false;
    }
    this.banned.set(peerId, Date.now() + maxAge);
    return true;
  }

  isBanned(peerId: string): boolean {
    const expireTime = this.banned.get(peerId);
    if (expireTime && expireTime > Date.now()) {
      return true;
    }
    this.banned.delete(peerId);
    return false;
  }

  async abort() {
    if (this.started) {
      await Promise.all(Array.from(this.peers.values()).map((peer) => peer.abort()));
      this.peers.clear();
      await this.stop();
    }
  }
}
