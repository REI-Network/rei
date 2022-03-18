import PeerId from 'peer-id';
import { Multiaddr } from 'multiaddr';
import { LevelUp } from 'levelup';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { logger, TimeoutQueue, ignoreError, InitializerWithEventEmitter } from '@rei-network/utils';
import { Peer, PeerStatus } from './peer';
import { Libp2pNode } from './libp2pnode';
import { Protocol } from './types';
import { ExpHeap } from './expheap';
import { NodeDB } from './nodedb';
import { randomOne } from './utils';

export * from './peer';
export * from './types';

const timeoutLoopInterval = 300e3;
const dialLoopInterval1 = 2e3;
const dialLoopInterval2 = 10e3;
const inboundThrottleTime = 30e3;
const outboundThrottleTime = 35e3;
const installTimeoutDuration = 3e3;

const defaultMaxPeers = 50;
const defaultMaxDials = 4;
const defaultTcpPort = 4191;
const defaultUdpPort = 9810;
const defaultNat = '127.0.0.1';

enum Libp2pPeerValue {
  installed = 1,
  connected = 0.5,
  incoming = 0
}

export interface NetworkManagerOptions {
  peerId: PeerId;
  protocols: Protocol[];
  nodedb: LevelUp;
  enable: boolean;
  datastore?: any;
  tcpPort?: number;
  udpPort?: number;
  nat?: string;
  maxPeers?: number;
  maxDials?: number;
  bootnodes?: string[];
}

export declare interface NetworkManager {
  on(event: 'installed', listener: (name: string, peer: Peer) => void): this;
  on(event: 'removed', listener: (peer: Peer) => void): this;

  off(event: 'installed', listener: (name: string, peer: Peer) => void): this;
  off(event: 'removed', listener: (peer: Peer) => void): this;
}

/**
 * Implement a decentralized p2p network between nodes, based on `libp2p`
 */
export class NetworkManager extends InitializerWithEventEmitter {
  private readonly protocols: Protocol[];
  private readonly nodedb: NodeDB;
  private privateKey!: Buffer;
  private libp2pNode!: Libp2pNode;
  private aborted: boolean = false;

  private readonly maxPeers: number;
  private readonly maxDials: number;
  private readonly options: NetworkManagerOptions;

  // a cache list that records all discovered peer,
  // the max size of this list is `this.maxPeers`
  private readonly discovered: string[] = [];
  // set that records all dialing peer id
  private readonly dialing = new Set<string>();
  // map that records all peers
  private readonly _peers = new Map<string, Peer>();
  // map that records all banned peers
  private readonly banned = new Map<string, number>();
  // map that records the latest message timestamp from the remote peer
  private readonly timeout = new Map<string, number>();

  // inbound and outbound history contains connection timestamp,
  // in order to prevent too frequent connections
  private readonly inboundHistory = new ExpHeap();
  private readonly outboundHistory = new ExpHeap();
  private outboundTimer: undefined | NodeJS.Timeout;

  // queue that records the timeout information of the remote peer
  private readonly installTimeoutQueue = new TimeoutQueue(installTimeoutDuration);
  private readonly installTimeoutId = new Map<string, number>();

  constructor(options: NetworkManagerOptions) {
    super();
    this.maxPeers = options.maxPeers ?? defaultMaxPeers;
    this.maxDials = options.maxDials ?? defaultMaxDials;
    this.protocols = options.protocols;
    this.nodedb = new NodeDB(options.nodedb);
    this.options = options;
  }

  /**
   * Return all installed peers
   */
  get peers() {
    return Array.from(this._peers.values()).filter((p) => p.status === PeerStatus.Installed);
  }

  /**
   * Set peer value
   * When `libp2p` disconnects a node, it will determine the order according to the peer value
   * @param peerId - Target peer
   * @param value - Peer value
   */
  private setPeerValue(peerId: string, value: Libp2pPeerValue) {
    this.libp2pNode.connectionManager.setPeerValue(peerId, value);
  }

  /**
   * Get installed peer by id
   * @param peerId - Target peer
   * @returns Peer or `undefined`
   */
  getPeer(peerId: string) {
    return this._peers.get(peerId);
  }

  /**
   * Disconnect a installing or installled peer by peer id
   * This will emit a `removed` event
   * @param peerId - Target peer
   */
  async removePeer(peerId: string) {
    this.timeout.delete(peerId);
    const peer = this._peers.get(peerId);
    if (peer) {
      this._peers.delete(peerId);
      await ignoreError(peer.abort());
      await ignoreError(this.disconnect(peerId));
      this.emit('removed', peer);
    }
  }

  /**
   * Ban peer by peer id
   * @param peerId - Target peer
   * @param maxAge - Ban time
   */
  async ban(peerId: string, maxAge = 60000) {
    this.banned.set(peerId, Date.now() + maxAge);
    await this.removePeer(peerId);
  }

  /**
   * Return peer ban status
   * @param peerId - Target peer
   * @returns `true` if the peer is banned, `false` if not
   */
  isBanned(peerId: string): boolean {
    const expireTime = this.banned.get(peerId);
    if (expireTime && expireTime > Date.now()) {
      return true;
    }
    this.banned.delete(peerId);
    return false;
  }

  private isDialable(peerId: string) {
    return !this.dialing.has(peerId) && !this._peers.has(peerId);
  }

  private disconnect(peerId: string): Promise<void> {
    return this.libp2pNode.hangUp(PeerId.createFromB58String(peerId));
  }

  // clear peer install timeout,
  // this will be called when a peer
  // disconnected or installed
  private clearInstallTimeout(peerId: string) {
    const id = this.installTimeoutId.get(peerId);
    if (id) {
      this.installTimeoutId.delete(peerId);
      this.installTimeoutQueue.clearTimeout(id);
    }
  }

  // create install timeout for a incoming peer,
  // disconnect the remote peer, if the remote peer
  // not installed after `installTimeoutDuration`
  private createInstallTimeout(peerId: string) {
    this.clearInstallTimeout(peerId);
    const id = this.installTimeoutQueue.setTimeout(() => {
      logger.debug('Network::createInstallTimeout, disconnect peerId:', peerId, ', because the installation timed out');
      this.disconnect(peerId);
    });
    this.installTimeoutId.set(peerId, id);
  }

  /**
   * Execute when a new node is discovered
   */
  private onDiscovered = (id: PeerId) => {
    const peerId: string = id.toB58String();
    if (!this.discovered.includes(peerId)) {
      logger.info('💬 Peer discovered:', peerId);
      this.discovered.push(peerId);
      if (this.discovered.length > this.maxPeers) {
        this.discovered.shift();
      }
    }
  };

  /**
   * Execute when a new node is connected
   */
  private onConnect = (connect) => {
    const peerId: string = connect.remotePeer.toB58String();
    if (this.isBanned(peerId)) {
      connect.close();
      logger.debug('Network::onConnect, peerId:', peerId, 'is banned');
      return;
    }
    // if (!this.checkInbound(peerId)) {
    //   connect.close();
    //   logger.debug('Network::onConnect, too many connection attempts');
    //   return;
    // }
    if (this.libp2pNode.connectionManager.size > this.maxPeers) {
      this.setPeerValue(peerId, Libp2pPeerValue.incoming);
      logger.debug('Network::onConnect, too many incoming connections');
    } else {
      logger.info('💬 Peer connect:', peerId);
      this.setPeerValue(peerId, Libp2pPeerValue.connected);
      // this.createInstallTimeout(peerId);
    }
  };

  /**
   * Execute when a node is disconnected
   */
  private onDisconnect = (connect) => {
    const peerId: string = connect.remotePeer.toB58String();
    logger.info('🤐 Peer disconnected:', peerId);
    this.dialing.delete(peerId);
    this.clearInstallTimeout(peerId);
    this.removePeer(peerId);
  };

  /**
   * Execute when a new enr is discovered
   * Persist new enr to db
   */
  private onENRAdded = (enr: ENR) => {
    this.nodedb.persist(enr);
  };

  /**
   * Execute when the enr of local node changed
   * Persist local node enr to db
   */
  private onMultiaddrUpdated = () => {
    const enr = this.libp2pNode.discv5.discv5.enr;
    const multiaddr = enr.getLocationMultiaddr('tcp4');
    if (multiaddr) {
      // update peer announce address
      this.libp2pNode.addressManager.announce = new Set([multiaddr.toString()]);
    }
    this.nodedb.persistLocal(enr, this.privateKey);
  };

  /**
   * Load local node enr from db
   * If the node id changes or the user-specified ip changes, then update it
   * @param options - User option
   * @returns enr and keypair
   */
  private async loadLocalENR(options: NetworkManagerOptions) {
    const keypair = createKeypairFromPeerId(options.peerId);
    let enr = ENR.createV4(keypair.publicKey);
    enr.tcp = options.tcpPort ?? defaultTcpPort;
    enr.udp = options.udpPort ?? defaultUdpPort;
    enr.ip = options.nat ?? defaultNat;
    const setNAT = !!options.nat;

    const localENR = await this.nodedb.loadLocal();
    if (localENR && localENR.nodeId === enr.nodeId && (!setNAT || (setNAT && enr.ip === localENR.ip))) {
      enr = localENR;
    } else {
      await this.nodedb.persistLocal(enr, keypair.privateKey);
    }
    return { enr, keypair };
  }

  /**
   * Initialize node
   */
  async init() {
    if (!this.options.enable) {
      this.initOver();
      return;
    }

    const { enr, keypair } = await this.loadLocalENR(this.options);
    const strEnr = enr.encodeTxt(keypair.privateKey);
    this.privateKey = keypair.privateKey;
    logger.info('NetworkManager::init, peerId:', this.options.peerId.toB58String());
    logger.info('NetworkManager::init,', strEnr);

    // filter local enr
    const bootnodes = (this.options.bootnodes ?? []).filter((b) => b !== strEnr);

    this.libp2pNode = new Libp2pNode({
      ...this.options,
      tcpPort: this.options.tcpPort ?? defaultTcpPort,
      udpPort: this.options.udpPort ?? defaultUdpPort,
      bootnodes: bootnodes,
      enr,
      maxConnections: this.maxPeers
    });

    this.initOver();
  }

  /**
   * Start node
   */
  start() {
    if (!this.options.enable) {
      return;
    }

    this.dialLoop();
    this.timeoutLoop();

    this.initPromise.then(async () => {
      this.protocols.forEach((protocol) => {
        this.libp2pNode.handle(protocol.protocolString, ({ connection, stream }) => {
          const peerId: string = connection.remotePeer.toB58String();
          this.install(peerId, protocol, stream).then((result) => {
            if (!result) {
              stream.close();
            }
          });
        });
      });
      this.libp2pNode.on('peer:discovery', this.onDiscovered);
      this.libp2pNode.connectionManager.on('peer:connect', this.onConnect);
      this.libp2pNode.connectionManager.on('peer:disconnect', this.onDisconnect);
      await this.libp2pNode.start();

      // load enr from nodes db.
      await this.nodedb.load((enr) => {
        this.libp2pNode.discv5.addEnr(enr);
      });
      this.libp2pNode.discv5.discv5.on('enrAdded', this.onENRAdded);
      this.libp2pNode.discv5.discv5.on('multiaddrUpdated', this.onMultiaddrUpdated);
    });
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

  /**
   * Install a peer and emit a `installed` event when successful
   * @param peerId - Target peer id
   * @param protocol - Array of protocols that need to be installed
   * @param streams - `libp2p` stream array
   * @returns Whether succeed
   */
  private async install(peerId: string, protocol: Protocol, stream: any) {
    if (this.isBanned(peerId)) {
      logger.debug('Network::install, failed due to peerId:', peerId, 'is banned');
      return false;
    }

    // if the peer doesn't exsit in `installing` or `installed`,
    // create a new one
    let peer = this._peers.get(peerId);
    if (!peer) {
      if (this.peers.length >= this.maxPeers) {
        logger.debug('Network::install, peerId:', peerId, 'failed due to too many peers installed');
        return false;
      }
      peer = new Peer(peerId, this);
      this._peers.set(peerId, peer);
    }

    if (peer.status === PeerStatus.Connected) {
      peer.status = PeerStatus.Installing;
    }
    const success = await peer.installProtocol(protocol, stream);
    if (success) {
      // if at least one protocol is installed, we think the handshake is successful
      peer.status = PeerStatus.Installed;
      this.setPeerValue(peerId, Libp2pPeerValue.installed);
      this.clearInstallTimeout(peerId);
      this.emit('installed', protocol.name, peer);
      logger.info('💬 Peer installed:', peerId, 'protocol:', protocol.name);
    } else {
      if (peer.status === PeerStatus.Installing) {
        peer.status = PeerStatus.Connected;
      }
      logger.debug('Network::install, install protocol:', protocol.name, 'for peerId:', peerId, 'failed');
    }
    return success;
  }

  /**
   * Try to dial a remote peer
   * @param peerId - Target peer id
   * @param protocols - Array of protocols that need to be dial
   * @returns Whether succeed and a `libp2p` stream array
   */
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
        // ignore all errors ...
        streams.push(null);
      }
    }
    if (!this.dialing.delete(peerId) || streams.reduce((b, s) => b && s === null, true)) {
      return { success: false, streams: [] };
    }
    return { success: true, streams };
  }

  /**
   * A loop to keep the number of node connections
   * Automatically load peer information from db or memory and try to dial
   */
  private async dialLoop() {
    await this.initPromise;
    while (!this.aborted) {
      try {
        if (this.peers.length < this.maxPeers && this.dialing.size < this.maxDials) {
          let peerId: string | undefined;
          // search discovered peer in memory
          while (this.discovered.length > 0) {
            const id = this.discovered.shift()!;
            if (this.checkOutbound(id) && this.isDialable(id) && !this.isBanned(id)) {
              const addresses: { multiaddr: Multiaddr }[] | undefined = this.libp2pNode.peerStore.addressBook.get(PeerId.createFromB58String(id));
              if (addresses && addresses.filter(({ multiaddr }) => multiaddr.toOptions().transport === 'tcp').length > 0) {
                peerId = id;
                logger.debug('NetworkManager::dialLoop, use a discovered peer:', peerId);
                break;
              }
            }
          }

          // search discovered peer in database
          if (!peerId) {
            let peers: {
              id: PeerId;
              addresses: { multiaddr: Multiaddr }[];
            }[] = Array.from(this.libp2pNode.peerStore.peers.values());
            peers = peers.filter((peer) => {
              const id = peer.id.toB58String();
              let b = peer.addresses.filter(({ multiaddr }) => multiaddr.toOptions().transport === 'tcp').length > 0;
              b &&= this.isDialable(id);
              b &&= !this.isBanned(id);
              b &&= this.checkOutbound(id);
              return b;
            });
            if (peers.length > 0) {
              const { id } = randomOne(peers);
              peerId = id.toB58String();
              logger.debug('NetworkManager::dialLoop, use a stored peer:', peerId);
            }
          }

          // try to dial discovered peer
          if (peerId) {
            this.updateOutbound(peerId);
            this.dial(peerId, this.protocols).then(async ({ success, streams }) => {
              if (success) {
                streams.forEach((stream, i) => {
                  if (stream !== null) {
                    this.install(peerId!, this.protocols[i], stream);
                  }
                });
              }
            });
          }
        }
      } catch (err) {
        logger.error('NetworkManager::dialLoop, catch error:', err);
      }
      await new Promise((r) => setTimeout(r, this.peers.length < this.maxPeers ? dialLoopInterval1 : dialLoopInterval2));
    }
  }

  /**
   * Update target peer's timestamp
   * Should be called when a message from the target peer is received
   * @param peerId - Target peer
   * @param timestamp - Timestamp
   */
  updateTimestamp(peerId: string, timestamp: number = Date.now()) {
    this.timeout.set(peerId, timestamp);
  }

  /**
   * A loop to disconnect the remote node that has not had a message for too long
   */
  private async timeoutLoop() {
    await this.initPromise;
    while (!this.aborted) {
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
   * Abort all remote peers and stop `libp2p`
   */
  async abort() {
    this.aborted = true;
    this.libp2pNode?.unhandle(this.protocols.map(({ protocolString }) => protocolString));
    this.libp2pNode?.off('peer:discovery', this.onDiscovered);
    this.libp2pNode?.connectionManager.off('peer:connect', this.onConnect);
    this.libp2pNode?.connectionManager.off('peer:disconnect', this.onDisconnect);
    this.libp2pNode?.discv5?.discv5.off('enrAdded', this.onENRAdded);
    this.libp2pNode?.discv5?.discv5.off('multiaddrUpdated', this.onMultiaddrUpdated);
    await Promise.all(Array.from(this._peers.values()).map((peer) => this.removePeer(peer.peerId)));
    this.dialing.clear();
    this._peers.clear();
    await ignoreError(this.libp2pNode?.stop());
  }
}
