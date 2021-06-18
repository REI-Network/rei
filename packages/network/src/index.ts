import { EventEmitter } from 'events';
import PeerId from 'peer-id';
import LevelStore from 'datastore-level';
import { logger } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer } from './peer';
import { Libp2pNode } from './libp2pnode';
import { INode } from './types';
import { makeProtocol } from './protocol';

export * from './peer';

export declare interface NetworkManager {
  on(event: 'idle' | 'busy', listener: (peer: Peer, type: string) => void): this;
  on(event: 'added' | 'removed', listener: (peer: Peer) => void): this;

  once(event: 'idle' | 'busy', listener: (peer: Peer, type: string) => void): this;
  once(event: 'added' | 'removed', listener: (peer: Peer) => void): this;
}

export interface NetworkManagerOptions {
  node: INode;
  peerId: PeerId;
  dbPath: string;
  maxSize?: number;
  protocols?: string[];
  tcpPort?: number;
  wsPort?: number;
  bootnodes?: string[];
}

const ignoredErrors = new RegExp(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'].join('|'));

function error(err: any) {
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

export class NetworkManager extends EventEmitter {
  public readonly node: INode;
  private readonly protocols: string[];
  private readonly _peers = new Map<string, Peer>();
  private readonly banned = new Map<string, number>();
  private readonly maxSize: number;
  private readonly initPromise: Promise<void>;
  private libp2pNode!: Libp2pNode;

  constructor(options: NetworkManagerOptions) {
    super();
    this.node = options.node;
    this.maxSize = options.maxSize || 32;
    this.protocols = options.protocols || [constants.GXC2_ETHWIRE];
    this.initPromise = this.init(options);
  }

  get peers() {
    return Array.from(this._peers.values());
  }

  get size() {
    return this._peers.size;
  }

  private toPeer(peerId: string | Peer) {
    return typeof peerId === 'string' ? this._peers.get(peerId) : peerId;
  }

  private toPeerId(peerId: string | Peer) {
    return typeof peerId === 'string' ? peerId : peerId.peerId;
  }

  private createPeer(peerInfo: PeerId) {
    const peer = new Peer({ peerId: peerInfo.toB58String(), libp2pNode: this.libp2pNode, node: this.node });
    this._peers.set(peer.peerId, peer);
    peer.on('idle', (type) => {
      if (this._peers.get(peer.peerId)) {
        this.emit('idle', peer, type);
      }
    });
    peer.on('busy', (type) => {
      if (this._peers.get(peer.peerId)) {
        this.emit('busy', peer, type);
      }
    });
    peer.on('error', (err) => {
      error(err);
    });
    this.emit('added', peer);
    return peer;
  }

  async removePeer(peerId: string | Peer) {
    const peer = this.toPeer(peerId);
    if (peer) {
      if (this._peers.delete(peer.peerId)) {
        this.emit('removed', peer);
      }
      await peer.abort();
    }
  }

  getPeer(peerId: string) {
    return this._peers.get(peerId);
  }

  async ban(peerId: string | Peer, maxAge = 60000) {
    this.banned.set(this.toPeerId(peerId), Date.now() + maxAge);
    await this.removePeer(peerId);
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

  async init(options?: NetworkManagerOptions) {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    if (!options) {
      throw new Error('NetworkManager::init, missing options');
    }

    const datastore = new LevelStore(options.dbPath, { createIfMissing: true });
    await datastore.open();
    this.libp2pNode = new Libp2pNode({
      ...options,
      datastore
    });
    this.protocols.forEach((protocol) => {
      // TODO: improve makeProtocol.
      this.libp2pNode.handle(makeProtocol(protocol).protocolString, async ({ connection, stream }) => {
        try {
          const peerId: PeerId = connection.remotePeer;
          const id = peerId.toB58String();
          const peer = this._peers.get(id);
          if (peer && (await peer.acceptProtocol(stream, protocol, this.node.status))) {
            logger.info('💬 Peer handled:', peer.peerId);
            this.emit('connected', peer);
          }
        } catch (err) {
          error(err);
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
        const results = await Promise.all(this.protocols.map((protocol) => peer.installProtocol(peerId, protocol, this.node.status)));
        if (results.reduce((a, b) => a || b, false)) {
          logger.info('💬 Peer discovered:', peer.peerId);
          this.emit('connected', peer);
        }
      } catch (err) {
        await this.removePeer(id);
        error(err);
      }
    });
    this.libp2pNode.connectionManager.on('peer:connect', async (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        if (!this._peers.get(id)) {
          this.createPeer(connect.remotePeer);
          logger.info('💬 Peer connected:', id);
        }
      } catch (err) {
        error(err);
      }
    });
    this.libp2pNode.connectionManager.on('peer:disconnect', async (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        await this.removePeer(id);
        logger.info('🤐 Peer disconnected:', id);
      } catch (err) {
        error(err);
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
