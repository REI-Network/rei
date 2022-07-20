import EventEmitter from 'events';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import { Discv5Discovery, ENR, KademliaRoutingTable, SessionService } from '@gxchain2/discv5';
import { Connection, IDiscv5, ILibp2p, Stream } from './types';
import * as c from './config';
const Libp2p = require('libp2p');

export interface Libp2pNodeOptions {
  peerId: PeerId;
  enr: ENR;
  tcpPort?: number;
  udpPort?: number;
  maxConnections?: number;
  bootnodes?: string[];
}

/**
 * `libp2p` node
 */
class Libp2pNode extends Libp2p {
  constructor(options: Libp2pNodeOptions) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${options.tcpPort ?? c.defaultTcpPort}`],
        noAnnounce: [`/ip4/127.0.0.1/tcp/${options.tcpPort ?? c.defaultTcpPort}`]
      },
      modules: {
        transport: [TCP],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: [Discv5Discovery]
      },
      config: {
        relay: {
          enabled: false
        },
        peerDiscovery: {
          autoDial: false,
          discv5: {
            enr: options.enr,
            bindAddr: `/ip4/0.0.0.0/udp/${options.udpPort ?? c.defaultUdpPort}`,
            bootEnrs: options.bootnodes ?? []
          }
        }
      },
      connectionManager: {
        maxConnections: options.maxConnections ?? c.defaultMaxConnections,
        minConnections: 0
      },
      dialer: {
        dialTimeout: 5e3
      },
      peerStore: {
        threshold: 0
      }
    });
  }

  /**
   * Only can get value after libp2p has been started
   */
  get discv5(): Discv5Discovery {
    return this._discovery.get(Discv5Discovery.tag);
  }

  get kbuckets(): KademliaRoutingTable {
    return (this.discv5.discv5 as any).kbuckets;
  }

  get sessionService(): SessionService {
    return (this.discv5.discv5 as any).sessionService;
  }
}

/**
 * Impl for {@link ILibp2p}
 */
class Libp2pImpl extends EventEmitter implements ILibp2p {
  readonly libp2pNode: Libp2pNode;

  constructor(libp2pNode: Libp2pNode) {
    super();
    this.libp2pNode = libp2pNode;
  }

  get peerId(): PeerId {
    return this.libp2pNode.peerId;
  }

  get maxConnections(): number {
    return this.libp2pNode.connectionManager._options.maxConnections;
  }

  get connectionSize(): number {
    return this.libp2pNode.connectionManager.size;
  }

  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void) {
    this.libp2pNode.handle(protocols, callback);
  }

  unhandle(protocols: string | string[]) {
    this.libp2pNode.unhandle(protocols);
  }

  addAddress(peerId: PeerId, addresses: Multiaddr[]) {
    this.libp2pNode.peerStore.addressBook.add(peerId, addresses);
  }

  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.libp2pNode.peerStore.addressBook.get(peerId);
  }

  dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    return this.libp2pNode.dialProtocol(peer);
  }

  hangUp(peerId: PeerId | string): Promise<void> {
    return this.libp2pNode.hangUp(peerId);
  }

  setPeerValue(peerId: PeerId | string, value: number) {
    this.libp2pNode.connectionManager.setPeerValue(peerId, value);
  }

  setAnnounce(addresses: Multiaddr[]) {
    this.libp2pNode.addressManager.announce = new Set<string>(addresses.map((addr) => addr.toString()));
  }

  getConnections(peerId: string): Connection[] | undefined {
    return this.libp2pNode.connectionManager.connections.get(peerId);
  }

  start(): Promise<void> {
    this.libp2pNode.on('peer:discovery', (...args: any[]) => this.emit('discovery', ...args));
    this.libp2pNode.connectionManager.on('peer:connect', (...args: any[]) => this.emit('connect', ...args));
    this.libp2pNode.connectionManager.on('peer:disconnect', (...args: any[]) => this.emit('disconnect', ...args));
    return this.libp2pNode.start();
  }

  stop(): Promise<void> {
    this.libp2pNode.removeAllListeners('peer:discovery');
    this.libp2pNode.connectionManager.removeAllListeners('peer:connect');
    this.libp2pNode.connectionManager.removeAllListeners('peer:disconnect');
    return this.libp2pNode.stop();
  }
}

/**
 * Impl for {@link IDiscv5}
 */
class Discv5Impl extends EventEmitter implements IDiscv5 {
  readonly libp2pNode: Libp2pNode;

  constructor(libp2pNode: Libp2pNode) {
    super();
    this.libp2pNode = libp2pNode;
  }

  get localEnr() {
    return this.libp2pNode.discv5.discv5.enr;
  }

  addEnr(enr: string | ENR) {
    this.libp2pNode.discv5.addEnr(enr);
  }

  findEnr(nodeId: string): ENR | undefined {
    return (this.libp2pNode.discv5.discv5 as any).findEnr(nodeId);
  }

  start() {
    this.libp2pNode.sessionService.on('message', (...args: any[]) => this.emit('message', ...args));
    this.libp2pNode.discv5.discv5.on('multiaddrUpdated', (...args: any[]) => this.emit('multiaddrUpdated', ...args));
  }

  stop() {
    this.libp2pNode.sessionService.removeAllListeners('message');
    this.libp2pNode.discv5.discv5.removeAllListeners('multiaddrUpdated');
  }
}

/**
 * Create default `libp2p` and `discv5` impl
 * @param options - {@link Libp2pNodeOptions}
 */
export function createDefaultImpl(options: Libp2pNodeOptions) {
  const node = new Libp2pNode(options);
  return {
    libp2p: new Libp2pImpl(node),
    discv5: new Discv5Impl(node)
  };
}
