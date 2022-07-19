import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { LevelUp } from 'levelup';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
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
  static = 1.5,
  installed = 1,
  connected = 0.5,
  incoming = 0
}

type PeerInfo = {
  id: string;
  addresses: { multiaddr: Multiaddr }[];
};

enum PeerFlag {
  dynDialedConn = 0,
  staticDialedConn = 1,
  inboundConn = 2,
  turstedConn = 3
}

type DialTask = {
  enr: ENR;
  peerId: string;
  staticPoolIndex: number;
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

  // static peers
  private static = new Map<string, DialTask>();
  private staticPool: DialTask[] = [];

  private trusted: Set<string> = new Set();

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

  async kbucketPeers() {
    const result: string[] = [];
    for (const enr of this.libp2pNode.kbuckets.values()) {
      result.push((await enr.peerId()).toB58String());
    }
    return result;
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
    if (this.libp2pNode.connectionManager.size < this.maxPeers || this.trusted.has(peerId)) {
      logger.info(`💬 Peer ${(await this.localEnr.peerId()).toB58String()} connect:`, peerId);
      const task = this.static.get(peerId);
      if (task && task.staticPoolIndex >= 0) {
        this.removeFromStaticPool(task.staticPoolIndex);
      }
      this.setPeerValue(peerId, Libp2pPeerValue.connected);
      // this.createInstallTimeout(peerId);
    } else {
      this.setPeerValue(peerId, Libp2pPeerValue.incoming);
      logger.debug('Network::onConnect, too many incoming connections');
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
    this.removePeer(peerId, false);
  };

  /**
   * Execute when a new enr is discovered
   * Persist new enr to db
   */
  private onDiscovered = async (peerInfo: PeerId) => {
    const enr: ENR | undefined = (this.libp2pNode.discv5.discv5 as any).findEnr(ENR.createFromPeerId(PeerId.createFromBytes(peerInfo.id)).nodeId);
    if (!enr || !this.checkEnr(enr)) {
      return;
    }
    const peerId: string = (await enr.peerId()).toB58String();
    let include: boolean = false;
    for (const id of this.discovered) {
      if (id === peerId) {
        include = true;
        break;
      }
    }
    if (!include) {
      this.discovered.push(peerId);
      if (this.discovered.length > this.maxPeers) {
        this.discovered.shift();
      }
    }
    await this.nodedb.persist(enr);
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
      this.localEnr.encode(this.privateKey);
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
      logger.info('NetworkManager::init, nodeId', enr.nodeId);
      logger.info('NetworkManager::init,', strEnr);

      // filter local enr
      const bootnodes = (this.options.bootnodes ?? []).filter((b) => b !== strEnr);
      // add to discovered
      for (const bootnode of bootnodes) {
        const enr = ENR.decodeTxt(bootnode);
        this.discovered.push((await enr.peerId()).toB58String());
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
    this.libp2pNode.on('peer:discovery', this.onDiscovered);
    this.libp2pNode.connectionManager.on('peer:connect', this.onConnect);
    this.libp2pNode.connectionManager.on('peer:disconnect', this.onDisconnect);
    await this.libp2pNode.start();

    this.libp2pNode.sessionService.on('message', this.onMessage);
    this.libp2pNode.discv5.discv5.on('multiaddrUpdated', this.onMultiaddrUpdated);

    const enrs = await this.nodedb.querySeeds(seedCount, seedMaxAge);
    for (const enr of enrs) {
      this.libp2pNode.discv5.addEnr(enr);
    }

    this.checkNodes();
    this.dialLoop();
    this.timeoutLoop();
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

  private checkInstall(id: string) {
    for (const peer of this.peers) {
      if (peer.peerId === id) {
        return false;
      }
    }
    return true;
  }

  private setupOutboundTimer(now: number) {
    if (!this.outboundTimer) {
      const next = this.outboundHistory.nextExpiry();
      if (next) {
        const sep = next - now;
        if (sep > 0) {
          this.outboundTimer = setTimeout(() => {
            const _now = Date.now();
            this.updateStaticPool(this.outboundHistory.expire(_now).peerId);
            this.outboundTimer = undefined;
            this.setupOutboundTimer(_now);
          }, sep);
        } else {
          this.updateStaticPool(this.outboundHistory.expire(now).peerId);
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
  private async install(peerId: string, protocol: Protocol, stream: any, peerFlag: PeerFlag = PeerFlag.dynDialedConn): Promise<boolean> {
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
      if (this.peers.length >= this.maxPeers && !this.trusted.has(peerId)) {
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
      let value: Libp2pPeerValue = Libp2pPeerValue.connected;
      if (peerFlag === PeerFlag.staticDialedConn) {
        value = Libp2pPeerValue.static;
      }
      this.setPeerValue(peerId, value);
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
  private async dialAndInstall(peerId: string, flag: PeerFlag) {
    if (this.isBanned(peerId) || this.dialing.has(peerId)) {
      return false;
    }
    this.dialing.add(peerId);
    let success = false;
    for (const _protocol of this.protocols) {
      for (const protocol of Array.isArray(_protocol) ? _protocol : [_protocol]) {
        try {
          const { stream } = await this.libp2pNode.dialProtocol(PeerId.createFromB58String(peerId), protocol.protocolString);
          if (await this.install(peerId, protocol, stream, flag)) {
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
    if (!this.checkAddresses(addresses)) {
      return false;
    }
    if (!this.checkPeerId(id)) {
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
          let slots = this.maxPeers - this.libp2pNode.connectionManager.size;
          slots -= await this.startStaticDials(slots);
          if (slots === 0) {
            await new Promise((r) => setTimeout(r, dialLoopInterval2));
            continue;
          }
          this.startDiscoveryDials();
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
            await this.removePeer(peerId, false);
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
    this.libp2pNode?.off('peer:discovery', this.onDiscovered);
    this.libp2pNode?.discv5?.discv5.off('multiaddrUpdated', this.onMultiaddrUpdated);
    await Promise.all(Array.from(this._peers.values()).map((peer) => this.removePeer(peer.peerId)));
    this.dialing.clear();
    this._peers.clear();
    await ignoreError(this.libp2pNode?.stop());
  }

  getConnectionSize() {
    return this.peers.length;
  }

  isTrusted(peerId: string) {
    return this.trusted.has(peerId);
  }

  addTrustedPeer(peerId: string) {
    this.trusted.add(peerId);
  }

  removeTrustedPeer(peerId: string) {
    this.trusted.delete(peerId);
  }

  async addPeer(enr: string) {
    try {
      const enrObj = ENR.decodeTxt(enr);
      const peerId = (await enrObj.peerId()).toB58String();
      if (this.static.has(peerId)) {
        return true;
      }
      const task = { enr: enrObj, staticPoolIndex: -1, flag: PeerFlag.staticDialedConn, peerId };
      this.static.set(peerId, task);
      if (await this.checkDial(enrObj)) {
        this.addToStaticPool(task);
      }
      this.libp2pNode.peerStore.addressBook.add(await enrObj.peerId(), [this.getLocationMultiaddr(enrObj, 'tcp')]);
      // this.libp2pNode.discv5.addEnr(enrObj);
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  }

  /**
   * Disconnect a installing or installled peer by peer id
   * This will emit a `removed` event
   * @param peerId - Target peer
   */
  async removePeer(peerId: string, isStrict: boolean = true) {
    if (isStrict) {
      let task = this.static.get(peerId);
      if (task) {
        this.static.delete(peerId);
        if (task.staticPoolIndex >= 0) {
          this.removeFromStaticPool(task.staticPoolIndex);
        }
      }
    }
    this.timeout.delete(peerId);
    const peer = this._peers.get(peerId);
    if (peer) {
      this._peers.delete(peerId);
      await ignoreError(peer.abort());
      await ignoreError(this.disconnect(peerId));
      this.emit('removed', peer);
    }
    this.updateStaticPool(peerId);
  }

  private async startDiscoveryDials() {
    let pid: string | undefined;
    // search discovered peer in memory
    while (this.discovered.length > 0) {
      const peerId = this.discovered.shift()!;
      if (this.static.has(peerId)) {
        continue;
      }
      let addr = this.libp2pNode.peerStore.addressBook.get(PeerId.createFromB58String(peerId));
      if (addr) {
        if (this.filterPeer({ id: peerId, addresses: addr })) {
          pid = peerId;
          break;
        }
      }
    }
    // try to dial a discovered peer
    if (pid) {
      this.startDial(pid);
    }
  }

  private startStaticDials(n: number) {
    let count = 0;
    const staticNodes = this.staticPool.filter((v, i) => {
      let task = this.staticPool[i];
      const enr = task.enr;
      const multiaddr = this.getLocationMultiaddr(enr, 'tcp4');
      const peerId = task.peerId;
      return multiaddr && this.filterPeer({ id: peerId, addresses: [{ multiaddr }] });
    });
    for (let started = 0; started < n && staticNodes.length > 0; started++) {
      let index = Math.ceil(Math.random() * (this.staticPool.length - 1));
      let task = this.staticPool[index];
      const peerId = task.peerId;
      this.startDial(peerId).then((success) => {
        if (!success) {
          this.updateStaticPool(peerId);
        }
      });
      this.removeFromStaticPool(index);
      count++;
    }
    return count;
  }

  private addToStaticPool(task: DialTask) {
    if (task.staticPoolIndex >= 0) {
      throw new Error('task already in static pool');
    }
    this.staticPool.push(task);
    task.staticPoolIndex = this.staticPool.length - 1;
  }

  private removeFromStaticPool(index: number) {
    const task = this.staticPool[index];
    const end = this.staticPool.length - 1;
    this.staticPool[index] = this.staticPool[end];
    this.staticPool[index].staticPoolIndex = index;
    this.staticPool.pop();
    task.staticPoolIndex = -1;
  }

  private async checkDial(enr: ENR): Promise<boolean> {
    const localId = (await this.localEnr.peerId()).toB58String();
    const id = (await enr.peerId()).toB58String();
    if (id === localId) {
      return false;
    }
    if (!this.checkEnr(enr)) {
      return false;
    }
    if (!this.checkPeerId(id)) {
      return false;
    }
    return true;
  }

  private async updateStaticPool(id: string) {
    let task = this.static.get(id);
    if (task && task.staticPoolIndex < 0 && (await this.checkDial(task.enr))) {
      this.addToStaticPool(task);
    }
  }

  private async startDial(peerId: string, flag: PeerFlag = PeerFlag.dynDialedConn) {
    this.updateOutbound(peerId);
    return this.dialAndInstall(peerId, flag);
  }

  private checkEnr(enr: ENR) {
    if (!enr.ip && !enr.tcp) {
      return false;
    }
    return true;
  }

  private checkPeerId(id: string) {
    // make sure there are no repeat dials
    if (this.dialing.has(id)) {
      return false;
    }
    if (!this.checkInstall(id)) {
      return false;
    }
    // make sure the remote node is not banned
    if (this.isBanned(id)) {
      return false;
    }
    // make sure we don't dial too often
    if (this.outboundHistory.contains(id)) {
      return false;
    }
    return true;
  }

  private checkAddresses(addresses: { multiaddr: Multiaddr }[]) {
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
    return true;
  }

  private getLocationMultiaddr(enr: ENR, protocol: 'udp' | 'udp4' | 'udp6' | 'tcp' | 'tcp4' | 'tcp6'): Multiaddr | undefined {
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
}
