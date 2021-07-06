import { EventEmitter } from 'events';
import PeerId from 'peer-id';
import LevelStore from 'datastore-level';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { getRandomIntInclusive, logger } from '@gxchain2/utils';
import { Peer } from './peer';
import { Libp2pNode } from './libp2pnode';
import { Protocol } from './types';
import { ExpHeap } from './expheap';

export * from './peer';
export * from './types';

const installedPeerValue = 1;
const connectedPeerValue = 0.5;
const uselessPeerValue = 0;
const timeoutLoopInterval = 30e3;
const dialLoopInterval1 = 2e3;
const dialLoopInterval2 = 10e3;
const inboundThrottleTime = 30e3;
const outboundThrottleTime = 35e3;

const defaultMaxPeers = 50;
const defaultMaxConnections = 50;
const defaultMaxDials = 4;
const defaultTcpPort = 4191;
const defaultUdpPort = 9810;
const defaultNat = '127.0.0.1';

export declare interface NetworkManager {
  on(event: 'installed' | 'removed', listener: (peer: Peer) => void): this;
  once(event: 'installed' | 'removed', listener: (peer: Peer) => void): this;
}

const ignoredErrors = new RegExp(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'].join('|'));

/**
 * Handle errors other than predicted errors or errors without error messages
 * @param err Pending errors
 */

export function logNetworkError(prefix: string, err: any) {
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
  logger.error(prefix, ', error:', err);
}

export interface NetworkManagerOptions {
  peerId: PeerId;
  protocols: Protocol[];
  dbPath?: string;
  tcpPort?: number;
  udpPort?: number;
  nat?: string;
  maxPeers?: number;
  maxConnections?: number;
  maxDials?: number;
  bootnodes?: string[];
}

/**
 * NetworkManager manages nodes and node communications protocols connected
 * with local node
 */
export class NetworkManager extends EventEmitter {
  private readonly protocols: Protocol[];
  private readonly initPromise: Promise<void>;
  private libp2pNode!: Libp2pNode;

  private readonly maxPeers: number;
  private readonly maxConnections: number;
  private readonly maxDials: number;

  private readonly discovered: string[] = [];
  private readonly connected = new Set<string>();
  private readonly dialing = new Set<string>();
  private readonly installing = new Map<string, Peer>();
  private readonly installed = new Map<string, Peer>();
  private readonly banned = new Map<string, number>();
  private readonly timeout = new Map<string, number>();

  private readonly inboundHistory = new ExpHeap();
  private readonly outboundHistory = new ExpHeap();
  private outboundTimer: undefined | NodeJS.Timeout;

  constructor(options: NetworkManagerOptions) {
    super();
    this.maxPeers = options.maxPeers || defaultMaxPeers;
    this.maxConnections = options.maxConnections || defaultMaxConnections;
    if (this.maxPeers > this.maxConnections) {
      throw new Error('invalid maxPeers or maxConnections');
    }
    this.maxDials = options.maxDials || defaultMaxDials;
    this.protocols = options.protocols;
    this.initPromise = this.init(options);
    this.dialLoop();
    this.timeoutLoop();
  }

  /**
   * Return all nodes recorded
   */
  get peers() {
    return Array.from(this.installed.values());
  }

  private setPeerValue(peerId: string, value: 'installed' | 'connected' | 'useless') {
    this.libp2pNode.connectionManager.setPeerValue(peerId, value === 'installed' ? installedPeerValue : value === 'connected' ? connectedPeerValue : uselessPeerValue);
  }

  getPeer(peerId: string) {
    return this.installed.get(peerId);
  }

  async removePeer(peerId: string) {
    const peer = this.installed.get(peerId);
    if (peer) {
      if (this.installed.delete(peerId)) {
        this.emit('removed', peer);
        if (this.isConnected(peerId)) {
          this.connected.add(peerId);
          this.setPeerValue(peerId, 'connected');
        }
      }
      await peer.abort();
    }
  }

  /**
   * Set the node status to prohibited and remove from the map
   * @param peerId The peer to be banned
   * @param maxAge Prohibited duration
   * @returns
   */
  async ban(peerId: string, maxAge = 60000) {
    this.banned.set(peerId, Date.now() + maxAge);
    await this.removePeer(peerId);
  }

  /**
   * Determine whether a peer is banned
   * @param peerId peer's information
   * @returns `true` if the peer is banned, `false` if the peer is active
   */

  isBanned(peerId: string): boolean {
    const expireTime = this.banned.get(peerId);
    if (expireTime && expireTime > Date.now()) {
      return true;
    }
    this.banned.delete(peerId);
    return false;
  }

  /**
   * Initialization function, used to configure the operation of libp2p nodes
   * and start it to receive messages from other nodes
   * @param options
   * @returns
   */
  async init(options?: NetworkManagerOptions) {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    if (!options) {
      throw new Error('NetworkManager missing init options');
    }

    const keypair = createKeypairFromPeerId(options.peerId);
    const enr = ENR.createV4(keypair.publicKey);
    enr.tcp = options.tcpPort || defaultTcpPort;
    enr.udp = options.udpPort || defaultUdpPort;
    enr.ip = options.nat || defaultNat;
    logger.info('NetworkManager::init,', enr.encodeTxt(keypair.privateKey));

    let datastore: undefined | LevelStore;
    if (options.dbPath) {
      datastore = new LevelStore(options.dbPath, { createIfMissing: true });
      await datastore.open();
    }
    this.libp2pNode = new Libp2pNode({
      ...options,
      tcpPort: options.tcpPort || defaultTcpPort,
      udpPort: options.udpPort || defaultUdpPort,
      bootnodes: options.bootnodes || [],
      enr,
      maxConnections: this.maxConnections,
      datastore
    });
    this.protocols.forEach((protocol) => {
      this.libp2pNode.handle(protocol.protocolString, ({ connection, stream }) => {
        const peerId: string = connection.remotePeer.toB58String();
        if (this.checkInbound(peerId)) {
          this.connected.delete(peerId);
          this.install(peerId, [protocol], [stream]).then((result) => {
            if (!result) {
              stream.close();
              if (this.isConnected(peerId)) {
                this.connected.add(peerId);
              }
            }
          });
        } else {
          stream.close();
        }
      });
    });
    this.libp2pNode.on('peer:discovery', (id: PeerId) => {
      const peerId: string = id.toB58String();
      if (!this.discovered.includes(peerId)) {
        logger.info('💬 Peer discovered:', peerId);
        this.discovered.push(peerId);
        if (this.discovered.length > this.maxPeers) {
          this.discovered.shift();
        }
      }
    });
    this.libp2pNode.connectionManager.on('peer:connect', (connect) => {
      const peerId: string = connect.remotePeer.toB58String();
      if (this.libp2pNode.connectionManager.size > this.maxConnections) {
        this.setPeerValue(peerId, 'useless');
      } else {
        logger.info('💬 Peer connect:', peerId);
        this.setPeerValue(peerId, 'connected');
      }
      if (!this.dialing.has(peerId) && !this.installing.has(peerId) && !this.installed.has(peerId)) {
        this.connected.add(peerId);
      }
    });
    this.libp2pNode.connectionManager.on('peer:disconnect', (connect) => {
      const peerId: string = connect.remotePeer.toB58String();
      logger.info('🤐 Peer disconnected:', peerId);
      this.connected.delete(peerId);
      this.dialing.delete(peerId);
      const peer = this.installing.get(peerId);
      if (peer) {
        this.installing.delete(peerId);
        peer.abort();
      }
      this.removePeer(peerId);
    });
    await this.libp2pNode.start();
  }

  private checkInbound(peerId: string) {
    const now = Date.now();
    this.inboundHistory.expire(now);
    if (this.inboundHistory.contains(peerId)) {
      return false;
    }
    this.inboundHistory.add(peerId, now + inboundThrottleTime);
    return true;
  }

  private checkOutbound(peerId: string) {
    return !this.outboundHistory.contains(peerId);
  }

  private setupOutboundTimer(now: number) {
    if (!this.outboundTimer) {
      const next = this.outboundHistory.nextExpiry();
      if (next) {
        const sep = next - now;
        if (sep > 0) {
          this.outboundTimer = setTimeout(() => {
            const _now = Date.now();
            this.outboundHistory.expire(_now);
            this.outboundTimer = undefined;
            this.setupOutboundTimer(_now);
          }, sep);
        } else {
          this.outboundHistory.expire(now);
        }
      }
    }
  }

  private updateOutbound(peerId: string) {
    const now = Date.now();
    this.outboundHistory.add(peerId, now + outboundThrottleTime);
    this.setupOutboundTimer(now);
  }

  private async install(peerId: string, protocols: Protocol[], streams: any[]) {
    if (this.isBanned(peerId) || this.installing.has(peerId)) {
      return false;
    }
    let peer = this.installed.get(peerId);
    if (!peer) {
      if (this.installed.size + 1 > this.maxPeers) {
        return false;
      }
      peer = new Peer(peerId, this);
    }
    this.installing.set(peerId, peer);
    const results = await Promise.all(
      protocols.map((protocol, i) => {
        return streams[i] ? peer!.installProtocol(protocol, streams[i]) : false;
      })
    );
    if (this.installing.delete(peerId) && results.reduce((a, b) => a || b, false)) {
      logger.info('💬 Peer installed:', peerId);
      this.installed.set(peerId, peer);
      this.setPeerValue(peerId, 'installed');
      this.emit('installed', peer);
      return true;
    }
    await peer.abort();
    return false;
  }

  private async dial(peerId: string, protocols: Protocol[]) {
    if (this.isBanned(peerId) || this.dialing.has(peerId)) {
      return { success: false, streams: [] };
    }
    this.dialing.add(peerId);
    const streams: any[] = [];
    for (const protocol of protocols) {
      try {
        const { stream } = await this.libp2pNode.dialProtocol(PeerId.createFromB58String(peerId), protocol.protocolString);
        streams.push(stream);
      } catch (err) {
        logNetworkError('NetworkManager::dial', err);
        streams.push(null);
      }
    }
    if (!this.dialing.delete(peerId) || streams.reduce((b, s) => b && s === null, true)) {
      return { success: false, streams: [] };
    }
    return { success: true, streams };
  }

  private randomOne<T>(array: T[]) {
    return array[getRandomIntInclusive(0, array.length - 1)];
  }

  // private matchProtocols(protocols: string[]) {
  //   for (const protocol of this.protocols) {
  //     if (protocols.includes(protocol.protocolString)) {
  //       return true;
  //     }
  //   }
  //   return false;
  // }

  private isConnected(peerId: string) {
    return this.libp2pNode.connectionManager.get(PeerId.createFromB58String(peerId)) !== null;
  }

  private async dialLoop() {
    await this.initPromise;
    while (true) {
      try {
        if (this.installed.size < this.maxPeers && this.dialing.size < this.maxDials) {
          let peerId: string | undefined;
          if (this.connected.size > 0) {
            const filtered = Array.from(this.connected.values()).filter((peerId) => !this.isBanned(peerId) && this.checkOutbound(peerId));
            if (filtered.length > 0) {
              peerId = this.randomOne(filtered);
              this.connected.delete(peerId);
              logger.debug('NetworkManager::dialLoop, use a connected peer:', peerId);
            }
          }
          if (!peerId) {
            while (this.discovered.length > 0) {
              const id = this.discovered.shift()!;
              if (this.checkOutbound(id) && !this.dialing.has(id) && !this.installing.has(id) && !this.installed.has(id) && !this.isBanned(id)) {
                peerId = id;
                logger.debug('NetworkManager::dialLoop, use a discovered peer:', peerId);
                break;
              }
            }
          }
          if (!peerId) {
            const peers: {
              id: PeerId;
              addresses: any[];
              protocols: string[];
            }[] = Array.from(this.libp2pNode.peerStore.peers.values());
            const peerIds = peers
              .filter((peer) => {
                const id = peer.id.toB58String();
                let b = peer.addresses.length > 0;
                b &&= !this.dialing.has(id) && !this.installing.has(id) && !this.installed.has(id);
                b &&= !this.isBanned(id);
                b &&= this.checkOutbound(id);
                return b;
              })
              .map(({ id }) => id.toB58String());
            if (peerIds.length > 0) {
              peerId = this.randomOne(peerIds);
              logger.debug('NetworkManager::dialLoop, use a stored peer:', peerId);
            }
          }

          if (peerId) {
            this.updateOutbound(peerId);
            this.dial(peerId, this.protocols).then(async ({ success, streams }) => {
              if (!success || !(await this.install(peerId!, this.protocols, streams))) {
                streams.forEach((stream) => stream.close());
                if (this.isConnected(peerId!)) {
                  this.connected.add(peerId!);
                }
              }
            });
          }
        }
      } catch (err) {
        logger.error('NetworkManager::dialLoop, catch error:', err);
      }
      await new Promise((r) => setTimeout(r, this.installed.size < this.maxPeers ? dialLoopInterval1 : dialLoopInterval2));
    }
  }

  updateTimestamp(peerId: string, timestamp: number = Date.now()) {
    this.timeout.set(peerId, timestamp);
  }

  private async timeoutLoop() {
    await this.initPromise;
    while (true) {
      try {
        await new Promise((r) => setTimeout(r, timeoutLoopInterval));
        const now = Date.now();
        for (const [peerId, timestamp] of this.timeout) {
          if (now - timestamp >= timeoutLoopInterval) {
            logger.debug('NetworkManager::timeoutLoop, remove:', peerId);
            await this.removePeer(peerId);
          }
        }
      } catch (err) {
        logger.error('NetworkManager::timeoutLoop, catch error:', err);
      }
    }
  }

  /**
   * Stop all node connections and delete data
   */
  async abort() {
    await Promise.all(Array.from(this.installed.values()).map((peer) => peer.abort()));
    await Promise.all(Array.from(this.installing.values()).map((peer) => peer.abort()));
    this.connected.clear();
    this.dialing.clear();
    this.installing.clear();
    this.installed.clear();
    await this.libp2pNode.stop();
    this.removeAllListeners();
  }
}
