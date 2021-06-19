import { EventEmitter } from 'events';
import PeerId from 'peer-id';
import LevelStore from 'datastore-level';
import { logger } from '@gxchain2/utils';
import { Peer } from './peer';
import { Libp2pNode } from './libp2pnode';
import { Protocol } from './types';

export * from './peer';
export * from './types';

export declare interface NetworkManager {
  on(event: 'added' | 'removed', listener: (peer: Peer) => void): this;

  once(event: 'added' | 'removed', listener: (peer: Peer) => void): this;
}

export interface NetworkManagerOptions {
  peerId: PeerId;
  dbPath: string;
  protocols: Protocol[];
  maxSize?: number;
  tcpPort?: number;
  wsPort?: number;
  bootnodes?: string[];
}

const ignoredErrors = new RegExp(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'].join('|'));

function logError(err: any) {
  if (err.message && ignoredErrors.test(err.message)) {
    return;
  }
  if (err.errors) {
    if (Array.isArray(err.errors)) {
      for (const e of err.errors) {
        if (ignoredErrors.test(e.message)) {
          return;
        }
      }
    } else if (typeof err.errors === 'string') {
      if (ignoredErrors.test(err.errors)) {
        return;
      }
    }
  }
  logger.error('NetworkManager, error:', err);
}

export type PeerType = string | Peer | PeerId;

export class NetworkManager extends EventEmitter {
  private readonly protocols: Protocol[];
  private readonly _peers = new Map<string, Peer>();
  private readonly banned = new Map<string, number>();
  private readonly maxSize: number;
  private readonly initPromise: Promise<void>;
  private libp2pNode!: Libp2pNode;

  constructor(options: NetworkManagerOptions) {
    super();
    this.maxSize = options.maxSize || 32;
    this.protocols = options.protocols;
    this.initPromise = this.init(options);
  }

  get peers() {
    return Array.from(this._peers.values());
  }

  get size() {
    return this._peers.size;
  }

  private toPeer(peerId: PeerType) {
    if (typeof peerId === 'string') {
      return this._peers.get(peerId);
    } else if (peerId instanceof PeerId) {
      return this._peers.get(peerId.toB58String());
    } else {
      return peerId;
    }
  }

  private toPeerId(peerId: PeerType) {
    if (typeof peerId === 'string') {
      return peerId;
    } else if (peerId instanceof PeerId) {
      return peerId.toB58String();
    } else {
      return peerId.peerId;
    }
  }

  private createPeer(peerInfo: PeerId) {
    const peer = new Peer(peerInfo.toB58String(), this);
    this._peers.set(peer.peerId, peer);
    this.emit('added', peer);
    return peer;
  }

  async removePeer(peerId: PeerType) {
    const peer = this.toPeer(peerId);
    if (peer) {
      if (this._peers.delete(peer.peerId)) {
        this.emit('removed', peer);
      }
      await peer.abort();
    }
  }

  getPeer(peerId: PeerType) {
    return this.toPeer(peerId);
  }

  async ban(peerId: PeerType, maxAge = 60000) {
    this.banned.set(this.toPeerId(peerId), Date.now() + maxAge);
    await this.removePeer(peerId);
    return true;
  }

  isBanned(peerId: PeerType): boolean {
    const id = this.toPeerId(peerId);
    const expireTime = this.banned.get(id);
    if (expireTime && expireTime > Date.now()) {
      return true;
    }
    this.banned.delete(id);
    return false;
  }

  async init(options?: NetworkManagerOptions) {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    if (!options) {
      throw new Error('NetworkManager missing init options');
    }

    const datastore = new LevelStore(options.dbPath, { createIfMissing: true });
    await datastore.open();
    this.libp2pNode = new Libp2pNode({
      ...options,
      datastore
    });
    this.protocols.forEach((protocol) => {
      this.libp2pNode.handle(protocol.protocolString, async ({ connection, stream }) => {
        const peerId: PeerId = connection.remotePeer;
        try {
          const peer = this.toPeer(peerId);
          if (peer && (await peer.installProtocol(protocol, stream))) {
            logger.info('💬 Peer handled:', peer.peerId);
          }
        } catch (err) {
          await this.removePeer(peerId);
          logError(err);
        }
      });
    });
    this.libp2pNode.on('peer:discovery', async (peerId: PeerId) => {
      const id = peerId.toB58String();
      try {
        if (this._peers.get(id) || this.isBanned(id)) {
          return;
        }
        const peer = this.createPeer(peerId);
        const results = await Promise.all(
          this.protocols.map(async (protocol) => {
            return peer.installProtocol(protocol, await this.libp2pNode.dialProtocol(peerId, protocol.protocolString));
          })
        );
        if (results.reduce((a, b) => a || b, false)) {
          logger.info('💬 Peer discovered:', peer.peerId);
        }
      } catch (err) {
        await this.removePeer(id);
        logError(err);
      }
    });
    this.libp2pNode.connectionManager.on('peer:connect', async (connect) => {
      const id = connect.remotePeer.toB58String();
      try {
        if (!this._peers.get(id)) {
          this.createPeer(connect.remotePeer);
          logger.info('💬 Peer connected:', id);
        }
      } catch (err) {
        await this.removePeer(id);
        logError(err);
      }
    });
    this.libp2pNode.connectionManager.on('peer:disconnect', async (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        await this.removePeer(id);
        logger.info('🤐 Peer disconnected:', id);
      } catch (err) {
        logError(err);
      }
    });

    // start libp2p
    await this.libp2pNode.start();
    logger.info('Libp2p has started', this.libp2pNode.peerId!.toB58String());
    this.libp2pNode.multiaddrs.forEach((ma) => {
      logger.info(ma.toString() + '/p2p/' + this.libp2pNode.peerId!.toB58String());
    });
  }

  async abort() {
    await Promise.all(Array.from(this._peers.values()).map((peer) => peer.abort()));
    this._peers.clear();
    await this.libp2pNode.stop();
    this.removeAllListeners();
  }
}
