import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { LevelUp } from 'levelup';
import { v4, v6 } from 'is-ip';
import { ENR, EntryStatus } from '@gxchain2/discv5';
import Semaphore from 'semaphore-async-await';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { MessageType } from '@gxchain2/discv5/lib/message';
import { logger, TimeoutQueue, ignoreError } from '@rei-network/utils';
import { Peer, PeerStatus } from './peer';
import { Libp2pNode } from './libp2pnode';
import { Protocol, ProtocolHandler } from './types';
import { ExpHeap } from './expheap';
import { NodeDB } from './nodedb';

export * from './peer';
export * from './types';

const checkNodesInterval = 30e3;
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

const seedCount = 30;
const seedMaxAge = 5 * 24 * 60 * 60 * 1000;

enum Libp2pPeerValue {
  installed = 1,
  connected = 0.5,
  incoming = 0
}

type PeerInfo = {
  id: string;
  addresses: { multiaddr: Multiaddr }[];
};

type IdType = {
  peerId: string;
  nodeId: string;
};

export interface NetworkManagerOptions {
  peerId: PeerId;
  protocols: (Protocol | Protocol[])[];
  nodedb: LevelUp;
  enable: boolean;
  tcpPort?: number;
  udpPort?: number;
  nat?: string;
  maxPeers?: number;
  maxDials?: number;
  bootnodes?: string[];
}

export declare interface NetworkManager {
  on(event: 'installed', listener: (handler: ProtocolHandler) => void): this;
  on(event: 'removed', listener: (peer: Peer) => void): this;

  off(event: 'installed', listener: (handler: ProtocolHandler) => void): this;
  off(event: 'removed', listener: (peer: Peer) => void): this;
}

/**
 * Implement a decentralized p2p network between nodes, based on `libp2p`
 */
export class NetworkManager extends EventEmitter {
  private readonly protocols: (Protocol | Protocol[])[];
  private readonly nodedb: NodeDB;
  private privateKey!: Buffer;
  private libp2pNode!: Libp2pNode;
  private aborted: boolean = false;
  private initPromise?: Promise<void>;
  private readonly maxPeers: number;
  private readonly maxDials: number;
  private readonly options: NetworkManagerOptions;

  private lock = new Semaphore(1);

  // a cache list that records all discovered peer,
  // the max size of this list is `this.maxPeers`
  private readonly discovered: IdType[] = [];
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

  get localEnr() {
    return this.libp2pNode.discv5.discv5.enr;
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
   * Execute when a new node is connected
   */
  private onConnect = async (connect) => {
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
      logger.info(`💬 Peer ${(await this.localEnr.peerId()).toB58String()} connect:`, peerId);
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
  private onENRAdded = async (enr: ENR) => {
    if (!this.checkENR(enr)) {
      return;
    }
    const peerId: string = (await enr.peerId()).toB58String();
    logger.info(`💬 Peer ${(await this.localEnr.peerId()).toB58String()} discovered:`, peerId);
    let include: boolean = false;
    for (const id of this.discovered) {
      if (id.peerId === peerId) {
        include = true;
        break;
      }
    }
    if (!include) {
      this.discovered.push({ peerId: peerId, nodeId: enr.nodeId });
      if (this.discovered.length > this.maxPeers) {
        this.discovered.shift();
      }
    }
    await this.libp2pNode.peerStore.addressBook.add(await enr.peerId(), [enr.getLocationMultiaddr('tcp')]);
    await this.nodedb.persist(enr);
  };

  //@todo check enr
  private checkENR = (enr: ENR) => {
    if (!enr.ip || !enr.nodeId) {
      return false;
    }
    return true;
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
    this.nodedb.storeLocalSeq(enr.nodeId, enr.seq);
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

    if (options.nat === undefined || v4(options.nat)) {
      enr.ip = options.nat ?? defaultNat;
      enr.tcp = options.tcpPort ?? defaultTcpPort;
      enr.udp = options.udpPort ?? defaultUdpPort;
    } else if (options.nat !== undefined && v6(options.nat)) {
      // enr.ip6 = options.nat;
      // enr.tcp6 = options.tcpPort ?? defaultTcpPort;
      // enr.udp6 = options.udpPort ?? defaultUdpPort;
      throw new Error('IPv6 is currently not supported');
    } else {
      throw new Error('invalid ip address: ' + options.nat);
    }
    enr.seq = await this.nodedb.localSeq(enr.nodeId);
    return { enr, keypair };
  }

  /**
   * Initialize node
   */
  init() {
    if (!this.options.enable) {
      return Promise.resolve();
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    return (this.initPromise = (async () => {
      const { enr, keypair } = await this.loadLocalENR(this.options);
      const strEnr = enr.encodeTxt(keypair.privateKey);
      this.privateKey = keypair.privateKey;
      logger.info('NetworkManager::init, peerId:', this.options.peerId.toB58String());
      logger.info('NetworkManager::init,', strEnr);

      // filter local enr
      const bootnodes = (this.options.bootnodes ?? []).filter((b) => b !== strEnr);
      // add to discovered
      for (const bootnode of bootnodes) {
        const enr = ENR.decodeTxt(bootnode);
        this.discovered.push({ peerId: (await enr.peerId()).toB58String(), nodeId: enr.nodeId });
      }
      this.libp2pNode = new Libp2pNode({
        ...this.options,
        tcpPort: this.options.tcpPort ?? defaultTcpPort,
        udpPort: this.options.udpPort ?? defaultUdpPort,
        bootnodes: bootnodes,
        enr,
        maxConnections: this.maxPeers
      });
    })());
  }

  /**
   * Start node
   */
  async start() {
    if (!this.options.enable) {
      return;
    }
    //init protocols
    for (const _protocol of this.protocols) {
      for (const protocol of Array.isArray(_protocol) ? _protocol : [_protocol]) {
        this.libp2pNode.handle(protocol.protocolString, ({ connection, stream }) => {
          const peerId: string = connection.remotePeer.toB58String();
          this.install(peerId, protocol, stream).then((result) => {
            if (!result) {
              stream.close();
            }
          });
        });
      }
    }
    this.libp2pNode.connectionManager.on('peer:connect', this.onConnect);
    this.libp2pNode.connectionManager.on('peer:disconnect', this.onDisconnect);
    await this.libp2pNode.start();

    this.libp2pNode.discv5.discv5.on('enrAdded', this.onENRAdded);
    this.libp2pNode.sessionService.on('message', this.onMessage);
    this.libp2pNode.discv5.discv5.on('multiaddrUpdated', this.onMultiaddrUpdated);

    const enrs = await this.nodedb.querySeeds(seedCount, seedMaxAge);
    for (const enr of enrs) {
      this.libp2pNode.discv5.addEnr(enr);
    }

    this.checkNodes();
    this.dialLoop();
    this.timeoutLoop();

    // setInterval(async () => {
    //   console.log(`localENr ${(await this.localEnr.peerId()).toB58String()} kbucket size :==>`, this.libp2pNode.discv5.discv5.connectedPeerCount);
    // }, 5 * 1000);
  }

  // Listen to the pong message of the remote node
  // and update the timestamp of the node in the database
  private onMessage = (srcId: string, src, message): void => {
    if (message.type === MessageType.PONG) {
      this.nodedb.updatePongMessage(srcId, src.nodeAddress().address);
    }
  };

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
    await this.lock.acquire();

    if (this.isBanned(peerId)) {
      logger.debug('Network::install, failed due to peerId:', peerId, 'is banned');
      this.lock.release();
      return false;
    }

    // if the peer doesn't exsit in `installing` or `installed`,
    // create a new one
    let peer = this._peers.get(peerId);
    if (!peer) {
      if (this.peers.length >= this.maxPeers) {
        logger.debug('Network::install, peerId:', peerId, 'failed due to too many peers installed');
        this.lock.release();
        return false;
      }
      peer = new Peer(peerId, this);
      this._peers.set(peerId, peer);
    }

    if (peer.status === PeerStatus.Connected) {
      peer.status = PeerStatus.Installing;
    }
    const { success, handler } = await peer.installProtocol(protocol, stream);
    if (success) {
      // if at least one protocol is installed, we think the handshake is successful
      peer.status = PeerStatus.Installed;
      this.setPeerValue(peerId, Libp2pPeerValue.installed);
      this.clearInstallTimeout(peerId);
      this.emit('installed', handler!);
      logger.info('💬 Peer installed:', peerId, 'protocol:', protocol.protocolString);
    } else {
      if (peer.status === PeerStatus.Installing) {
        peer.status = PeerStatus.Connected;
      }
      logger.debug('Network::install, install protocol:', protocol.protocolString, 'for peerId:', peerId, 'failed');
    }

    this.lock.release();
    return success;
  }

  /**
   * Try to dial a remote peer and install procotol
   * @param peerId - Target peer id
   * @returns Whether succeed
   */
  private async dialAndInstall(peerId: string) {
    if (this.isBanned(peerId) || this.dialing.has(peerId)) {
      return false;
    }
    this.dialing.add(peerId);
    let success = false;
    for (const _protocol of this.protocols) {
      for (const protocol of Array.isArray(_protocol) ? _protocol : [_protocol]) {
        try {
          const { stream } = await this.libp2pNode.dialProtocol(PeerId.createFromB58String(peerId), protocol.protocolString);
          if (await this.install(peerId, protocol, stream)) {
            success = true;
            break;
          } else {
            stream.close();
          }
        } catch (err) {
          logger.debug('Network::dialAndInstall, failed to dial peerId:', peerId, 'protocol:', protocol.protocolString, err);
          // ignore errors...
        }
      }
    }
    if (!this.dialing.delete(peerId) || !success) {
      return false;
    }
    return true;
  }

  /**
   * Determine if remote node can be dialed
   * @param param0 - Peer information
   * @returns Whether the remote node can be dialed
   */
  private filterPeer({ id, addresses }: PeerInfo) {
    // filter all address
    if (
      addresses.filter(({ multiaddr }) => {
        const options = multiaddr.toOptions();

        // filter all address information containing tcp
        if (options.transport !== 'tcp') {
          return false;
        }

        // there are some problems with the dependencies of multiaddrs
        const family: any = options.family;

        // filter invalid address information
        if (family === 'ipv4' || family === 4) {
          // ipv4
          if (options.host === '127.0.0.1') {
            return false;
          }
        } else {
          // ipv6
          return false;
        }

        return true;
      }).length === 0
    ) {
      return false;
    }

    // make sure there are no repeat dials
    if (!this.isDialable(id)) {
      return false;
    }

    // make sure the remote node is not banned
    if (this.isBanned(id)) {
      return false;
    }

    // make sure we don't dial too often
    if (!this.checkOutbound(id)) {
      return false;
    }

    for (const peer of this.peers) {
      if (peer.peerId === id) {
        console.log('Network::filterPeer, peerId:', id, 'is dialing');
        return false;
      }
    }

    if (this.dialing.has(id)) {
      console.log('Network::filterPeer, peerId:', id, 'is dialing');
      return false;
    }

    return true;
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
          let pid: string | undefined;
          // search discovered peer in memory
          while (this.discovered.length > 0) {
            const { peerId, nodeId } = this.discovered.shift()!;
            const entry = this.libp2pNode.kbuckets.getWithPending(nodeId);
            if (entry && entry.status === EntryStatus.Connected) {
              let addr = this.getLocationMultiaddr(entry.value, 'tcp4');
              if (addr) {
                if (this.filterPeer({ id: peerId, addresses: [{ multiaddr: addr }] })) {
                  pid = peerId;
                  logger.debug(`NetworkManager::dialLoop, ${(await this.localEnr.peerId()).toB58String()} use a discovered peer:`, peerId);
                  break;
                }
              }
            }
          }
          // try to dial a discovered peer
          if (pid) {
            this.updateOutbound(pid);
            this.dialAndInstall(pid);
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

  private async checkNodes() {
    await this.initPromise;
    while (!this.aborted) {
      try {
        await this.nodedb.checkTimeout(seedMaxAge);
        await new Promise((r) => setTimeout(r, checkNodesInterval));
      } catch (err) {
        logger.error('NetworkManager::checkNodes, catch error:', err);
      }
    }
  }

  /**
   * Get multiaddr of the enr.(This is a discv5 version compatible function and needs to be deleted)
   * @param enr - Enr information
   * @param protocol - Protocol
   */
  private getLocationMultiaddr(enr: ENR, protocol: 'udp' | 'udp4' | 'udp6' | 'tcp' | 'tcp4' | 'tcp6'): Multiaddr | undefined {
    if (protocol === 'udp') {
      return this.getLocationMultiaddr(enr, 'udp4') || this.getLocationMultiaddr(enr, 'udp6');
    }
    if (protocol === 'tcp') {
      return this.getLocationMultiaddr(enr, 'tcp4') || this.getLocationMultiaddr(enr, 'tcp6');
    }
    const isIpv6 = protocol.endsWith('6');
    const isUdp = protocol.startsWith('udp');
    const isTcp = protocol.startsWith('tcp');
    const ipName = isIpv6 ? 'ip6' : 'ip4';
    const ipVal = isIpv6 ? enr.ip6 : enr.ip;
    if (!ipVal) {
      return undefined;
    }
    const protoName = (isUdp && 'udp') || (isTcp && 'tcp');
    if (!protoName) {
      return undefined;
    }
    const protoVal = isIpv6 ? (isUdp && enr.udp6) || (isTcp && enr.tcp6) : (isUdp && enr.udp) || (isTcp && enr.tcp);
    if (!protoVal) {
      return undefined;
    }
    return new Multiaddr(`/${ipName}/${ipVal}/${protoName}/${protoVal}`);
  }

  /**
   * Abort all remote peers and stop `libp2p`
   */
  async abort() {
    this.aborted = true;
    for (const _protocol of this.protocols) {
      for (const protocol of Array.isArray(_protocol) ? _protocol : [_protocol]) {
        this.libp2pNode?.unhandle(protocol.protocolString);
      }
    }
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
