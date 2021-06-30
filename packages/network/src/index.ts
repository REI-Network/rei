import { EventEmitter } from 'events';
import PeerId from 'peer-id';
import LevelStore from 'datastore-level';
import { getRandomIntInclusive, logger } from '@gxchain2/utils';
import { Peer } from './peer';
import { Libp2pNode } from './libp2pnode';
import { Protocol } from './types';

export * from './peer';
export * from './types';

const syncPeerValue = 1;
const pendingPeerValue = 0.5;

export declare interface NetworkManager {
  on(event: 'added' | 'installed' | 'removed', listener: (peer: Peer) => void): this;

  once(event: 'added' | 'installed' | 'removed', listener: (peer: Peer) => void): this;
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

const peerTimeout = 30000;
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
  private readonly _peers = new Map<string, { peer: Peer; timestamp: number }>();
  private readonly banned = new Map<string, number>();
  private readonly maxSize: number;
  private readonly pendingPeers = new Set<string>();
  private readonly dialingPeers = new Set<string>();
  private readonly initPromise: Promise<void>;
  private libp2pNode!: Libp2pNode;

  constructor(options: NetworkManagerOptions) {
    super();
    this.maxSize = options.maxSize || 32;
    this.protocols = options.protocols;
    this.initPromise = this.init(options);
    this.timeoutLoop();
  }

  get peers() {
    return Array.from(this._peers.values()).map(({ peer }) => peer);
  }

  get _pendingPeers() {
    return Array.from(this.pendingPeers.values());
  }

  get size() {
    return this._peers.size;
  }

  get isFull() {
    return this._peers.size >= this.maxSize;
  }

  private toPeer(peerId: PeerType) {
    if (typeof peerId === 'string') {
      return this._peers.get(peerId)?.peer;
    } else if (peerId instanceof PeerId) {
      return this._peers.get(peerId.toB58String())?.peer;
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
    this.pendingPeers.delete(peer.peerId);
    this.setPeerValue(peer.peerId, false);
    this._peers.set(peer.peerId, { peer, timestamp: Date.now() });
    this.emit('added', peer);
    return peer;
  }

  private pendingPeer(peerId: string) {
    console.log('new pending peer:', peerId);
    this.pendingPeers.add(peerId);
    this.setPeerValue(peerId, true);
  }

  private async upgradeRandomPendingPeer() {
    if (this.isFull) {
      return;
    }
    const pendingPeers = Array.from(this.pendingPeers.values()).filter((peerId) => !this.isBanned(peerId));
    if (pendingPeers.length === 0) {
      return;
    }
    await this.upgradePendingPeer(pendingPeers[getRandomIntInclusive(0, pendingPeers.length - 1)]);
  }

  private async upgradePendingPeer(peerId: string) {
    console.log('upgrade pending peer:', peerId);
    try {
      if (this._peers.get(peerId)) {
        console.log('NetworkMngr::upgradePendingPeer, peer:', peerId, 'repeated, return');
        return;
      } else {
        console.log('NetworkMngr::upgradePendingPeer, start upgrade, peer:', peerId);
      }
      this.dialingPeers.add(peerId);
      const { stream } = await this.libp2pNode.dialProtocol(PeerId.createFromB58String(peerId), this.protocols[0].protocolString);
      const peer = this.createPeer(PeerId.createFromB58String(peerId));
      if (await peer.installProtocol(this.protocols[0], stream)) {
        logger.info('💬 Peer upgrade:', peer.peerId);
        this.emit('installed', peer);
      } else {
        console.log('NetworkMngr::upgradePendingPeer, installProtocol failed');
        await this.removePeer(peerId);
      }
    } catch (err) {
      await this.removePeer(peerId, true);
      logError(err);
    } finally {
      this.dialingPeers.delete(peerId);
    }
  }

  async removePeer(peerId: PeerType, hangUp = false) {
    const peer = this.toPeer(peerId);
    if (peer) {
      await peer.abort();
      if (hangUp) {
        console.log('hangUp:', peer.peerId);
        await this.libp2pNode.hangUp(PeerId.createFromB58String(peer.peerId));
      }
      if (this._peers.delete(peer.peerId)) {
        this.emit('removed', peer);
        await this.upgradeRandomPendingPeer();
        if (!hangUp) {
          console.log('removePeer, hangUp:', hangUp);
          this.pendingPeer(peer.peerId);
        }
      }
    }
  }

  getPeer(peerId: PeerType) {
    return this.toPeer(peerId);
  }

  setPeerValue(peerId: string, pending: boolean) {
    this.libp2pNode.connectionManager.setPeerValue(peerId, pending ? pendingPeerValue : syncPeerValue);
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
          if (this.isFull || this.isBanned(peerId.toB58String())) {
            console.log('NetworkMngr::handle, peer:', peerId.toB58String(), 'has been banned or full, return');
            this.pendingPeer(peerId.toB58String());
            return;
          } else {
            console.log('NetworkMngr::handle, start handle, peer:', peerId.toB58String());
          }
          let peer = this.toPeer(peerId);
          if (!peer) {
            console.log('NetworkMngr::handle, create, peer:', peerId.toB58String());
            peer = this.createPeer(peerId);
          }
          if (await peer.installProtocol(protocol, stream)) {
            logger.info('💬 Peer handled:', peer.peerId);
            this.emit('installed', peer);
          } else {
            console.log('NetworkMngr::handle, installProtocol failed');
            await this.removePeer(peerId);
          }
        } catch (err) {
          await this.removePeer(peerId, true);
          logError(err);
        }
      });
    });
    this.libp2pNode.on('peer:discovery', async (peerId: PeerId) => {
      const id = peerId.toB58String();
      try {
        if (this.isFull || this._peers.get(id) || this.isBanned(id)) {
          console.log('NetworkMngr::discovery, peer:', id, 'has been banned or has been connected or full, return');
          return;
        } else {
          console.log('NetworkMngr::discovery, start dial, peer:', id);
        }
        this.dialingPeers.add(id);
        const streams = await Promise.all(
          this.protocols.map(async (protocol) => {
            return (await this.libp2pNode.dialProtocol(peerId, protocol.protocolString)).stream;
          })
        );
        const peer = this.createPeer(peerId);
        const results = await Promise.all(
          this.protocols.map((protocol, i) => {
            return peer.installProtocol(protocol, streams[i]);
          })
        );
        if (results.reduce((a, b) => a || b, false)) {
          logger.info('💬 Peer discovered:', peer.peerId);
          this.emit('installed', peer);
        } else {
          console.log('NetworkMngr::discovery, installProtocol failed');
          await this.removePeer(peerId);
        }
      } catch (err) {
        await this.removePeer(id, true);
        logError(err);
      } finally {
        this.dialingPeers.delete(id);
      }
    });
    this.libp2pNode.connectionManager.on('peer:connect', (connect) => {
      // logger.info('💬 Peer connect:', connect.remotePeer.toB58String());
      const peerId = connect.remotePeer;
      const id = connect.remotePeer.toB58String();
      const dial = async () => {
        try {
          if (this.isFull || this._peers.get(id) || this.isBanned(id)) {
            console.log('NetworkMngr::connect, peer:', id, 'has been banned or has been connected or full, return');
            this.pendingPeer(id);
            return;
          } else {
            console.log('NetworkMngr::connect, start dial, peer:', id);
          }
          this.dialingPeers.add(id);
          const streams = await Promise.all(
            this.protocols.map(async (protocol) => {
              return (await this.libp2pNode.dialProtocol(peerId, protocol.protocolString)).stream;
            })
          );
          const peer = this.createPeer(peerId);
          const results = await Promise.all(
            this.protocols.map((protocol, i) => {
              return peer.installProtocol(protocol, streams[i]);
            })
          );
          if (results.reduce((a, b) => a || b, false)) {
            logger.info('💬 Peer connect:', peer.peerId);
            this.emit('installed', peer);
          } else {
            console.log('NetworkMngr::connect, installProtocol failed');
            await this.removePeer(peerId);
          }
        } catch (err) {
          await this.removePeer(id, true);
          logError(err);
        } finally {
          this.dialingPeers.delete(id);
        }
      };
      setTimeout(
        () => {
          if (this.libp2pNode.connectionManager.connections.has(id) && !this.dialingPeers.has(id) && !this._peers.has(id) && !this.pendingPeers.has(id)) {
            console.log('NetworkMngr::connect, no repeat dial, start');
            dial();
          } else {
            console.log('NetworkMngr::connect, repeat dial, return');
          }
        },
        this.libp2pNode.peerId.toB58String() < id ? 1000 : 2000
      );
    });
    this.libp2pNode.connectionManager.on('peer:disconnect', async (connect) => {
      try {
        const id = connect.remotePeer.toB58String();
        this.pendingPeers.delete(id);
        await this.removePeer(id, true);
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

  updateTimestamp(peerId: string | PeerId, timestamp: number = Date.now()) {
    let peerInfo: undefined | { peer: Peer; timestamp: number };
    if (typeof peerId === 'string') {
      peerInfo = this._peers.get(peerId);
    } else if (peerId instanceof PeerId) {
      peerInfo = this._peers.get(peerId.toB58String());
    }
    if (peerInfo) {
      peerInfo.timestamp = timestamp;
    }
  }

  private async timeoutLoop() {
    await this.initPromise;
    while (true) {
      try {
        await new Promise((r) => setTimeout(r, peerTimeout));
        const now = Date.now();
        for (const [_, { peer, timestamp }] of this._peers) {
          if (now - timestamp >= peerTimeout) {
            console.log('timeoutLoop, remove');
            await this.removePeer(peer, true);
          }
        }
      } catch (err) {
        logger.error('NetworkManager::timeoutLoop, catch error:', err);
      }
    }
  }

  async abort() {
    await Promise.all(Array.from(this._peers.values()).map(({ peer }) => peer.abort()));
    this._peers.clear();
    await this.libp2pNode.stop();
    this.removeAllListeners();
  }

  async testDial(id: string, fullAddr: any) {
    try {
      if (!this._peers.get(id)) {
        console.log('NetworkMngr::testDial, peer:', id, "hasn't been connected, return");
        return;
      } else {
        console.log('NetworkMngr::testDial, start test dial, peer:', id);
      }
      const peer = this.toPeer(id);
      if (peer && (await peer.installProtocol(this.protocols[0], (await this.libp2pNode.dialProtocol(PeerId.createFromB58String(id), this.protocols[0].protocolString)).stream))) {
        logger.info('💬 Peer testDial:', peer.peerId);
        this.emit('installed', peer);
      } else {
        console.log('NetworkMngr::testDial, installProtocol failed');
      }
    } catch (err) {
      await this.removePeer(id);
      logError(err);
    }
  }
}
