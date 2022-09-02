import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { LevelUp } from 'levelup';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { Message as Discv5Message, MessageType } from '@gxchain2/discv5/lib/message';
import { logger, ignoreError, Channel, AbortableTimer } from '@rei-network/utils';
import { ExpHeap } from './expheap';
import { NodeDB } from './nodedb';
import { Peer } from './peer';
import { createDefaultImpl } from './libp2pImpl';
import { Protocol, ProtocolHandler, ILibp2p, IDiscv5, Connection, Stream } from './types';
import * as m from './messages';
import * as c from './config';

enum Libp2pPeerValue {
  trusted = 1.5,
  installed = 1,
  connected = 0.5,
  incoming = 0
}

type PeerInfo = {
  nodeId: string;
  peerId: string;
  caps: string[];
};

type NodeInfo = {
  enr: string;
  nodeId: string;
  peerId: string;
  ip: string;
  tcpPort: number;
  udpPort: number;
  caps: (string[] | string)[];
};

export interface NetworkManagerOptions {
  // local peer id
  peerId: PeerId;
  // supported protocols
  protocols: (Protocol | Protocol[])[];
  // levelup instance, used to store peer info
  nodedb: LevelUp;
  // check inbound, default: false
  enableInboundCheck?: boolean;
  // NAT address, default: 127.0.0.1
  nat?: string;
  // discv5 instance
  discv5?: IDiscv5;
  // libp2p instance
  libp2p?: ILibp2p;
  // inbound throttle interval
  inboundThrottleTime?: number;
  // outbound throttle interval
  outboundThrottleTime?: number;
  // libp2p constructor options
  libp2pOptions?: {
    // tcp port
    tcpPort?: number;
    // udp port, used for discovering peers
    udpPort?: number;
    // max connection size
    maxPeers?: number;
    // boot nodes list
    bootnodes?: string[];
  };
}

export declare interface NetworkManager {
  on(event: 'installed', listener: (peer: Peer, handler: ProtocolHandler) => void): this;
  on(event: 'uninstalled', listener: (peer: Peer, protocolString: string) => void): this;
  on(event: 'removed', listener: (peer: Peer) => void): this;

  off(event: 'installed', listener: (peer: Peer, handler: ProtocolHandler) => void): this;
  off(event: 'uninstalled', listener: (peer: Peer, protocolString: string) => void): this;
  off(event: 'removed', listener: (peer: Peer) => void): this;
}

/**
 * Implement a decentralized p2p network between nodes, based on `libp2p`
 */
export class NetworkManager extends EventEmitter {
  private readonly protocols: (Protocol | Protocol[])[];
  private readonly nodedb: NodeDB;
  private readonly discoveredPeers: string[] = [];
  private readonly _peers = new Map<string, Peer>();
  private readonly banned = new Map<string, number>();
  private readonly channel = new Channel<m.Message>({
    drop: (message) => {
      // resolve promise immediately
      if (message instanceof m.InstallMessage) {
        message.resolve && message.resolve(false);
      } else if (message instanceof m.RemovePeerMessage) {
        message.resolve && message.resolve();
      }
    }
  });

  // loop promise and timer
  private schedulePromise?: Promise<void>;
  private dialPromise?: Promise<void>;
  private dialTimer = new AbortableTimer();
  private checkTimeoutPromise?: Promise<void>;
  private checkTimeoutTimer = new AbortableTimer();
  private removePeerPromise?: Promise<void>;
  private removePeerTimer = new AbortableTimer();

  // inbound and outbound history contains connection timestamp,
  // in order to prevent too frequent connections
  private readonly inboundHistory = new ExpHeap();
  private readonly outboundHistory = new ExpHeap();
  private readonly enableInboundCheck: boolean;
  private outboundTimer: undefined | NodeJS.Timeout;

  private libp2p!: ILibp2p;
  private discv5!: IDiscv5;
  private privateKey!: Buffer;
  private options: NetworkManagerOptions;
  private aborted: boolean = false;

  // static peers
  private staticPeers = new Set<string>();
  // trusted peers
  private trustedPeers = new Set<string>();

  constructor(options: NetworkManagerOptions) {
    super();
    this.options = options;
    this.protocols = options.protocols;
    this.enableInboundCheck = options.enableInboundCheck ?? false;
    this.nodedb = new NodeDB(options.nodedb);
  }

  /**
   * Get local peer id
   */
  get peerId() {
    return this.libp2p.peerId.toB58String();
  }

  /**
   * Get local enr address
   */
  get localEnr() {
    return this.discv5.localEnr;
  }

  /**
   * Get installed peers
   */
  get peers() {
    return Array.from(this._peers.values());
  }

  /**
   * Get connected peers
   */
  get connectedPeers() {
    return Array.from(this._peers.values()).map((peer): PeerInfo => {
      const peerId = peer.peerId;
      const caps = peer.supportedProtocols;
      const connection = this.libp2p.getConnections(peer.peerId)![0];
      const nodeId = ENR.createFromPeerId(connection.remotePeer).nodeId;
      return { peerId, nodeId, caps };
    });
  }

  /**
   * Get connection size
   */
  get connectionSize() {
    return this.libp2p.connectionSize;
  }

  /**
   * Load local node enr from db
   * If the node id changes or the user-specified ip changes, then update it
   * @returns enr and keypair
   */
  private async loadLocalENR() {
    const keypair = createKeypairFromPeerId(this.options.peerId);
    let enr = ENR.createV4(keypair.publicKey);
    if (this.options.nat === undefined || v4(this.options.nat)) {
      enr.ip = this.options.nat ?? c.defaultNat;
      enr.tcp = this.options.libp2pOptions?.tcpPort ?? c.defaultTcpPort;
      enr.udp = this.options.libp2pOptions?.udpPort ?? c.defaultUdpPort;
    } else if (this.options.nat !== undefined && v6(this.options.nat)) {
      // enr.ip6 = options.nat;
      // enr.tcp6 = options.tcpPort ?? defaultTcpPort;
      // enr.udp6 = options.udpPort ?? defaultUdpPort;
      throw new Error('IPv6 is currently not supported');
    } else {
      throw new Error('invalid ip address: ' + this.options.nat);
    }
    // update enr seq
    enr.seq = await this.nodedb.localSeq(enr.nodeId);
    return { enr, keypair };
  }

  /**
   * Initialize
   */
  async init() {
    if (this.options.libp2p && this.options.discv5) {
      // directly use outside impl instance
      this.libp2p = this.options.libp2p;
      this.discv5 = this.options.discv5;
      this.privateKey = this.options.discv5.keyPair.privateKey;
    } else {
      if (this.options.libp2pOptions === undefined) {
        throw new Error('missing libp2p options');
      }

      // load enr from database
      const { enr, keypair } = await this.loadLocalENR();
      const strEnr = enr.encodeTxt(keypair.privateKey);
      this.privateKey = keypair.privateKey;
      logger.info('NetworkManager::init, peerId:', this.options.peerId.toB58String());
      logger.info('NetworkManager::init, nodeId', enr.nodeId);
      logger.info('NetworkManager::init,', strEnr);

      // create default impl instance
      const { libp2p, discv5 } = createDefaultImpl({
        ...this.options.libp2pOptions,
        bootnodes: (this.options.libp2pOptions.bootnodes ?? []).filter((value) => {
          return ENR.decodeTxt(value).nodeId !== enr.nodeId;
        }),
        peerId: this.options.peerId,
        enr
      });

      this.libp2p = libp2p;
      this.discv5 = discv5;
    }
  }

  /**
   * Start
   */
  async start() {
    // register all supported protocols to libp2p
    for (const protocols of this.protocols) {
      for (const protocol of Array.isArray(protocols) ? protocols : [protocols]) {
        this.libp2p.handle(protocol.protocolString, ({ connection, stream }) => {
          const peerId = connection.remotePeer.toB58String();
          this.pushMessage(new m.InstallMessage(peerId, protocol, connection, stream));
        });
      }
    }

    // listen libp2p events
    this.libp2p.on('discovery', this.onDiscovered);
    this.libp2p.on('connect', this.onConnect);
    this.libp2p.on('disconnect', this.onDisconnect);
    await this.libp2p.start();

    // listen discv5 events
    this.discv5.on('message', this.onMessage);
    this.discv5.on('multiaddrUpdated', this.onMultiaddrUpdated);
    this.discv5.start();

    // load seed nodes from database
    for (const enr of await this.nodedb.querySeeds(c.seedCount, c.seedMaxAge)) {
      this.discv5.addEnr(enr);
    }

    // start loops
    this.schedulePromise = this.scheduleLoop();
    this.dialPromise = this.dialLoop();
    this.checkTimeoutPromise = this.checkTimeoutLoop();
    this.removePeerPromise = this.removePeerLoop();
  }

  /**
   * Abort
   */
  async abort() {
    if (!this.aborted) {
      this.aborted = true;
      // release timeout
      if (this.outboundTimer) {
        clearTimeout(this.outboundTimer);
        this.outboundTimer = undefined;
      }
      // unregister all protocols
      for (const protocols of this.protocols) {
        for (const protocol of Array.isArray(protocols) ? protocols : [protocols]) {
          this.libp2p.unhandle(protocol.protocolString);
        }
      }
      // remove listeners
      this.libp2p.off('connect', this.onConnect);
      this.libp2p.off('disconnect', this.onDisconnect);
      this.libp2p.off('discovery', this.onDiscovered);
      this.discv5.off('message', this.onMessage);
      this.discv5.off('multiaddrUpdated', this.onMultiaddrUpdated);
      // remove all peers
      await Promise.all(Array.from(this._peers.values()).map((peer) => this.removePeer(peer.peerId)));
      this._peers.clear();
      // stop libp2p and discv5
      this.discv5.stop();
      await ignoreError(this.libp2p.stop());
      // close channel
      this.channel.abort();
      // abort timer
      this.dialTimer.abort();
      this.checkTimeoutTimer.abort();
      this.removePeerTimer.abort();
      // wait for loop to exit
      await this.schedulePromise;
      await this.dialPromise;
      await this.checkTimeoutPromise;
      await this.removePeerPromise;
      // release promise objects
      this.schedulePromise = undefined;
      this.dialPromise = undefined;
      this.checkTimeoutPromise = undefined;
      this.removePeerPromise = undefined;
    }
  }

  private onConnect = (connection: Connection) => {
    this.pushMessage(new m.ConnectedMessage(connection));
  };

  private onDisconnect = (connection: Connection) => {
    this.pushMessage(new m.DisconnectedMessage(connection));
  };

  private onDiscovered = (peerId: PeerId) => {
    this.pushMessage(new m.DiscoveredMessage(peerId));
  };

  private onMessage = (srcId: string, src: Multiaddr, message: Discv5Message) => {
    this.pushMessage(new m.ReceivedMessage(srcId, src, message));
  };

  private onMultiaddrUpdated = () => {
    this.pushMessage(new m.MultiaddrUpdatedMessage());
  };

  private pushMessage(message: m.Message) {
    this.channel.push(message);
  }

  /**
   * scheduleLoop will process all messages in sequence
   */
  private async scheduleLoop() {
    for await (const message of this.channel) {
      try {
        if (message instanceof m.InstallMessage) {
          const result = await this.install(message.peerId, message.protocol, message.connection, message.stream);
          message.resolve && message.resolve(result);
        } else if (message instanceof m.ConnectedMessage) {
          await this.connected(message.connection);
        } else if (message instanceof m.DisconnectedMessage) {
          await this.disconnected(message.connection);
        } else if (message instanceof m.DiscoveredMessage) {
          await this.discovered(message.peedId);
        } else if (message instanceof m.MultiaddrUpdatedMessage) {
          await this.multiaddrUpdated();
        } else if (message instanceof m.ReceivedMessage) {
          await this.receivedMessage(message.srcId, message.src, message.message);
        } else if (message instanceof m.RemovePeerMessage) {
          await this.doRemovePeer(message.peedId);
          message.resolve && message.resolve();
        } else {
          logger.warn('NetworkManager::scheduleLoop, unknown message');
        }
      } catch (err) {
        logger.error('NetworkManager::scheduleLoop, catch error:', err);
      }
    }
  }

  /**
   * dialLoop will keep trying to dial the discovered remote nodes
   */
  private async dialLoop() {
    const maybeRemoveFromDiscovered = (peerId: string) => {
      const index = this.discoveredPeers.indexOf(peerId);
      if (index !== -1) {
        this.discoveredPeers.splice(index, 1);
      }
    };

    // TODO: maybe parallel dial?
    while (!this.aborted) {
      // remove all invalid peers from discovered peer list
      for (const peerId of this.discoveredPeers) {
        if (this.isBanned(peerId) || this._peers.has(peerId) || peerId === this.peerId) {
          maybeRemoveFromDiscovered(peerId);
        }
      }

      if (this._peers.size < this.libp2p.maxConnections) {
        // filter all available static peers
        const staticPeers = Array.from(this.staticPeers).filter((peerId) => !this._peers.has(peerId) && !this.isBanned(peerId));

        // filter all peers in address book
        const addressBookPeers = this.libp2p.peers.filter((peerId) => !this._peers.has(peerId) && !this.isBanned(peerId));

        // filter all nodes that can be dialed
        const dialablePeers = [...staticPeers, ...this.discoveredPeers, ...addressBookPeers].filter((peerId) => this.checkOutbound(peerId));

        // pick the first one and dial
        const peerId = dialablePeers.shift();
        if (peerId) {
          if (staticPeers.indexOf(peerId) !== -1) {
            logger.debug('Network::dial, try to dial peer:', peerId, 'load from static peer list');
          } else if (this.discoveredPeers.indexOf(peerId) !== -1) {
            logger.debug('Network::dial, try to dial peer:', peerId, 'load from discovered peer list');
          } else {
            logger.debug('Network::dial, try to dial peer:', peerId, 'load from address book peer list');
          }
          maybeRemoveFromDiscovered(peerId);
          await this.dial(peerId);
        }
      }

      // sleep for a while
      await this.dialTimer.wait(c.dialLoopInterval);
    }
  }

  /**
   * checkTimeoutLoop will periodically delete dead nodes from the database
   */
  private async checkTimeoutLoop() {
    while (!this.aborted) {
      try {
        await this.nodedb.checkTimeout(c.seedMaxAge, (peerId) => {
          logger.debug('NetworkManager::checkTimeoutLoop, deleting timeout node:', peerId.toB58String());
          this.libp2p.removeAddress(peerId);
        });
      } catch (err) {
        logger.error('NetworkManager::checkTimeoutLoop, catch error:', err);
      }

      // sleep for a while
      await this.checkTimeoutTimer.wait(c.checkTimeoutInterval);
    }
  }

  /**
   * removePeerLoop will periodically remove inactive nodes in _peers
   */
  private async removePeerLoop() {
    while (!this.aborted) {
      // sleep for a while
      await this.removePeerTimer.wait(c.removePeerLoopInterval);

      const now = Date.now();
      for (const [peerId, peer] of this._peers) {
        if (peer.size === 0 && now - peer.createAt >= c.removePeerThrottle) {
          logger.debug('NetworkManager::removePeerLoop, remove peer:', peerId);
          await this.removePeer(peerId);
        }
      }
    }
  }

  /**
   * Install a peer and emit a `installed` event when successful
   * @param peerId - Peer id
   * @param protocol - Protocol object
   * @param connection - `libp2p` connection
   * @param stream - `libp2p` stream, if it doesn't exist, it will be created automatically
   * @returns Whether succeed
   */
  private async install(peerId: string, protocol: Protocol, connection: Connection, stream?: Stream) {
    const connections = this.libp2p.getConnections(peerId);
    if (!connections || connections.length === 0) {
      logger.debug('Network::install, peerId:', peerId, 'failed due to disconnected');
      return false;
    }

    if (this.isBanned(peerId)) {
      logger.debug('Network::install, peerId:', peerId, 'failed due to banned');
      return false;
    }

    // if the peer doesn't exsit in `installing` or `installed`,
    // create a new one
    let peer = this._peers.get(peerId);
    if (!peer) {
      peer = new Peer(peerId);
      peer.on('installed', (...args: any[]) => {
        this.emit('installed', peer, ...args);
      });
      peer.on('uninstalled', (...args: any[]) => {
        this.emit('uninstalled', peer, ...args);
      });
      this._peers.set(peerId, peer);
    }

    if (stream === undefined) {
      // attempt to establish a stream with the remote node
      try {
        const result = await connection.newStream(protocol.protocolString);
        stream = result.stream;
      } catch (err: any) {
        logger.detail('Network::install, peerId:', peerId, 'new stream failed, error:', err);
        return false;
      }
    }

    const { success } = await peer.installProtocol(protocol, connection, stream);
    if (success) {
      // if at least one protocol is installed, we think the handshake is successful
      const peerValue = this.trustedPeers.has(peerId) ? Libp2pPeerValue.trusted : Libp2pPeerValue.installed;
      this.libp2p.setPeerValue(PeerId.createFromB58String(peerId), peerValue);
      logger.info('💬 Peer installed:', peerId, 'protocol:', protocol.protocolString);
    } else {
      stream.close();
      logger.debug('Network::install, install protocol:', protocol.protocolString, 'for peerId:', peerId, 'failed');
    }
    return success;
  }

  /**
   * Try to dial a remote peer and install procotol
   * @param peerId - Target peer id
   * @returns Whether succeed
   */
  private async dial(peerId: string) {
    // update expired queue
    this.updateOutbound(peerId);

    // attempt to establish a connection with the remote node
    let connection: Connection;
    try {
      connection = await this.libp2p.dial(PeerId.createFromB58String(peerId));
    } catch (err) {
      logger.detail('Network::dial, failed to dial peerId:', peerId, 'error:', err);
      return;
    }

    // try to install all protocols
    for (const protocols of this.protocols) {
      // if it is an array, only install one of the protocols
      if (Array.isArray(protocols)) {
        const dial = (index: number) => {
          if (index >= protocols.length) {
            return;
          }
          new Promise<boolean>((resolve) => {
            this.pushMessage(new m.InstallMessage(peerId, protocols[index], connection, undefined, resolve));
          }).then((result) => {
            if (!result) {
              dial(index + 1);
            }
          });
        };
        dial(0);
      } else {
        this.pushMessage(new m.InstallMessage(peerId, protocols, connection));
      }
    }
  }

  /**
   * Handle on connect event
   * @param connection - `libp2p` connection
   */
  private async connected(connection: Connection) {
    const peerId = connection.remotePeer.toB58String();
    if (this.isBanned(peerId)) {
      await connection.close();
      logger.debug('Network::connected, peerId:', peerId, 'is banned');
      return;
    }

    if (!this.checkInbound(peerId)) {
      await connection.close();
      logger.debug('Network::connected, peerId:', peerId, 'too many connection attempts');
      return;
    }

    if (this.libp2p.connectionSize < this.libp2p.maxConnections || this.trustedPeers.has(peerId)) {
      logger.info('💬 Peer connect:', peerId);
      const peerValue = this.trustedPeers.has(peerId) ? Libp2pPeerValue.trusted : Libp2pPeerValue.connected;
      this.libp2p.setPeerValue(PeerId.createFromB58String(peerId), peerValue);
    } else {
      this.libp2p.setPeerValue(PeerId.createFromB58String(peerId), Libp2pPeerValue.incoming);
      logger.debug('Network::connected, too many incoming connections');
    }
  }

  /**
   * Handle disconnect event
   * @param connection - `libp2p` connection
   */
  private async disconnected(connection: Connection) {
    const peerId = connection.remotePeer.toB58String();
    if (this._peers.has(peerId)) {
      const conns = this.libp2p.getConnections(peerId);
      if (conns === undefined || conns.length === 0) {
        logger.info('🤐 Peer disconnected:', peerId);
        await this.doRemovePeer(peerId);
      }
    }
  }

  /**
   * Handle discover event
   * @param peerId - Peer id
   */
  private async discovered(peerId: PeerId) {
    const enr = this.discv5.findEnr(ENR.createFromPeerId(peerId).nodeId);
    if (!enr) {
      return;
    }

    const address = enr.getLocationMultiaddr('tcp');
    if (!address) {
      return;
    }

    // add peerId to memory list
    const strPeerId = peerId.toB58String();
    if (!this.discoveredPeers.includes(strPeerId) || !this._peers.has(strPeerId)) {
      this.discoveredPeers.push(strPeerId);
      if (this.discoveredPeers.length > this.libp2p.maxConnections * 2) {
        this.discoveredPeers.shift();
      }
    }

    // save enr to database
    await this.nodedb.persist(enr);
  }

  /**
   * Handle receive message event
   * @param srcId - Node id
   * @param src - Remove address
   * @param message - Discv5 message
   */
  private async receivedMessage(srcId: string, src: Multiaddr, message: Discv5Message) {
    if (message.type === MessageType.PONG) {
      await this.nodedb.updatePongMessage(srcId, src.nodeAddress().address);
    }
  }

  /**
   * Handle multiaddr updated event
   */
  private async multiaddrUpdated() {
    const enr = this.discv5.localEnr;
    const multiaddr = enr.getLocationMultiaddr('tcp');
    if (multiaddr) {
      // update peer announce address
      this.libp2p.setAnnounce([new Multiaddr(multiaddr.toString())]);
      // sign the enr address to ensure that
      // the database can be written normally afterwards
      enr.encode(this.privateKey);
      await this.nodedb.storeLocalSeq(enr.nodeId, enr.seq);
    }
  }

  /**
   * Disconnect a peer by peer id and emit a `removed` event
   * @param peerId - Peer id
   */
  private async doRemovePeer(peerId: string) {
    const peer = this._peers.get(peerId);
    if (peer) {
      peer.removeAllListeners();
      this._peers.delete(peerId);
      await ignoreError(peer.abort());
      await ignoreError(this.libp2p.hangUp(PeerId.createFromB58String(peerId)));
      this.emit('removed', peer);
    }
  }

  private checkInbound(peerId: string) {
    if (!this.enableInboundCheck) {
      return true;
    }
    const now = Date.now();
    this.inboundHistory.expire(now);
    if (this.inboundHistory.contains(peerId)) {
      return false;
    }
    this.inboundHistory.add(peerId, now + (this.options.inboundThrottleTime ?? c.inboundThrottleTime));
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
    this.outboundHistory.add(peerId, now + (this.options.outboundThrottleTime ?? c.outboundThrottleTime));
    this.setupOutboundTimer(now);
  }

  /**
   * Add static peer,
   * network manager will keep trying to connect static peer
   * @param enrTxt - ENR string
   * @returns Whether the addition was successful
   */
  async addPeer(enrTxt: string) {
    const enr = ENR.decodeTxt(enrTxt);
    const peerId = await enr.peerId();
    const peerIdTxt = peerId.toB58String();

    // prevent repetition
    if (peerIdTxt === this.peerId) {
      return false;
    }

    // check if enr is legal
    const addr = enr.getLocationMultiaddr('tcp');
    if (!addr) {
      return false;
    }

    // add id to memory set
    this.staticPeers.add(peerIdTxt);
    // add address to address book
    this.libp2p.addAddress(peerId, [new Multiaddr(addr.toString())]);
    return true;
  }

  /**
   * remove static peer
   * @param enrTxt - ENR string
   * @returns Whether the deletion of the static node was successful
   */
  async removeStaticPeer(enrTxt: string) {
    const enr = ENR.decodeTxt(enrTxt);
    const peerId = await enr.peerId();
    const peerIdTxt = peerId.toB58String();

    // prevent repetition
    if (peerIdTxt === this.peerId) {
      return false;
    }

    // remove id in memory set
    this.staticPeers.delete(peerIdTxt);
    return true;
  }

  /**
   * Add trusted peer,
   * network manager will always accept connection from trusted peers,
   * even if the number of connections is full
   * @param enrTxt - ENR string
   * @returns Whether the trusted node is added successfully
   */
  async addTrustedPeer(enrTxt: string) {
    const enr = ENR.decodeTxt(enrTxt);
    const peerId = await enr.peerId();
    const peerIdTxt = peerId.toB58String();
    if (peerIdTxt == this.peerId) {
      return false;
    }
    if (!this.trustedPeers.has(peerIdTxt)) {
      this.trustedPeers.add(peerIdTxt);
      if (this._peers.has(peerIdTxt)) {
        this.libp2p.setPeerValue(peerId, Libp2pPeerValue.trusted);
      }
    }
    return true;
  }

  /**
   * Remove trusted peer,
   * NOTE: this method does not immediately modify peerValue
   * @param enrTxt - ENR string
   * @returns Whether the deletion of the trust node is successful
   */
  async removeTrustedPeer(enrTxt: string) {
    const enr = ENR.decodeTxt(enrTxt);
    const peerId = await enr.peerId();
    const peerIdTxt = peerId.toB58String();
    this.trustedPeers.delete(peerIdTxt);
    return true;
  }

  /**
   * Check remote peer is trusted
   * @param enrTxt - ENR string
   * @returns Whether it is a trusted node
   */
  async isTrusted(enrTxt: string) {
    const enr = ENR.decodeTxt(enrTxt);
    const peerId = await enr.peerId();
    const peerIdTxt = peerId.toB58String();
    return this.trustedPeers.has(peerIdTxt);
  }

  /**
   * Disconnect remote peer
   * @param peerId - Peer id
   */
  removePeer(peerId: string) {
    return new Promise<void>((resolve) => {
      this.pushMessage(new m.RemovePeerMessage(peerId, resolve));
    });
  }

  /**
   * Get peer by id
   * @param peerId - Target peer
   * @returns Peer or `undefined`
   */
  getPeer(peerId: string) {
    return this._peers.get(peerId);
  }

  /**
   * Ban and disconnect remote peer
   * @param peerId - Peer id
   * @param maxAge - Ban time
   */
  ban(peerId: string, maxAge: number = 60000) {
    this.banned.set(peerId, Date.now() + maxAge);
    this.staticPeers.delete(peerId);
    return this.removePeer(peerId);
  }

  /**
   * Return peer ban status
   * @param peerId - Peer id
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

  /**
   * Get local node info
   * @returns local node info
   */
  get nodeInfo(): NodeInfo {
    const localEnr = this.localEnr;
    return {
      enr: localEnr.encodeTxt(),
      nodeId: localEnr.nodeId,
      peerId: this.peerId,
      ip: localEnr.ip!,
      tcpPort: localEnr.tcp!,
      udpPort: localEnr.udp!,
      caps: this.protocols.map((p) => {
        if (Array.isArray(p)) {
          return p.map(({ protocolString }) => protocolString);
        } else {
          return p.protocolString;
        }
      })
    };
  }
}
