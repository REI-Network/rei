import EventEmitter from 'events';
import levelup from 'levelup';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { ENR, IKeypair, createKeypairFromPeerId } from '@gxchain2/discv5';
import { Channel, AbortableTimer, getRandomIntInclusive } from '@rei-network/utils';
import { Connection, Stream, ILibp2p, IDiscv5 } from '../src/types';
import { NetworkManager } from '../src';

const memdown = require('memdown');

class MockStream implements Stream {
  private aborted: boolean = false;
  private conn: MockConn;
  private protocol: string;
  private output = new Channel<Buffer>();

  constructor(conn: MockConn, protocol: string) {
    this.conn = conn;
    this.protocol = protocol;
  }

  close(): void {
    if (!this.aborted) {
      this.aborted = true;
      this.output.abort();
    }
  }

  receiveData(data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.output.push(data);
  }

  sink = async (source: AsyncGenerator<Buffer, any, unknown>): Promise<void> => {
    for await (const data of source) {
      if (this.aborted) {
        break;
      }
      this.conn.sendData(this.protocol, data);
    }
  };

  source = async function* (this: MockStream) {
    for await (const data of this.output) {
      yield { _bufs: [data] };
    }
  }.bind(this);
}

class MockConn implements Connection {
  readonly id: number;
  readonly remotePeer: PeerId;

  private aborted: boolean = false;
  private libp2p: MockLibp2p;
  private streams = new Map<string, MockStream>();

  constructor(libp2p: MockLibp2p, remotePeer: PeerId, id: number) {
    this.id = id;
    this.libp2p = libp2p;
    this.remotePeer = remotePeer;
  }

  sendData(protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.libp2p.sendData(this.remotePeer.toB58String(), this.id, protocol, data);
  }

  receiveData(protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    const stream = this.streams.get(protocol);
    if (!stream) {
      // emit error
      return;
    }
    stream.receiveData(data);
  }

  async close(): Promise<void> {
    if (!this.aborted) {
      this.aborted = true;
      for (const stream of this.streams.values()) {
        stream.close();
      }
      this.streams.clear();
    }
  }

  private _newStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.close();
    }
    stream = new MockStream(this, protocol);
    this.streams.set(protocol, stream);
    return stream;
  }

  async newStream(protocols: string | string[]): Promise<{ stream: Stream }> {
    if (this.aborted) {
      throw new Error('stream closed');
    }
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.libp2p.newStream(this.remotePeer.toB58String(), this.id, protocols);
    return { stream: this._newStream(protocols) };
  }

  onNewStream(protocol: string) {
    if (this.aborted) {
      return;
    }
    return this._newStream(protocol);
  }

  _getStreams(): Stream[] {
    return Array.from(this.streams.values());
  }
}

type Handler = (input: { connection: Connection; stream: Stream }) => void;

type MockLibp2pConfig = {
  maxPeers: number;
};

class MockLibp2p extends EventEmitter implements ILibp2p {
  peerId: PeerId;
  announce = new Set<Multiaddr>();
  config: MockLibp2pConfig;

  private aborted = false;
  private service: Service;
  private discv5: MockDiscv5;
  private peerValues = new Map<string, number>();
  private addressBook = new Map<string, Multiaddr[]>();
  private conns = new Map<string, MockConn[]>();
  private handlers = new Map<string, Handler>();

  constructor(service: Service, discv5: MockDiscv5, peerId: PeerId, config: MockLibp2pConfig) {
    super();
    this.peerId = peerId;
    this.discv5 = discv5;
    this.service = service;
    this.config = config;
  }

  get peers(): string[] {
    return Array.from(this.conns.keys());
  }

  get maxConnections(): number {
    return this.config.maxPeers;
  }

  get connectionSize(): number {
    return Array.from(this.conns.values()).reduce((accumulator, value) => accumulator + value.length, 0);
  }

  sendData(to: string, id: number, protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.service.sendData(this.peerId.toB58String(), to, id, protocol, data);
  }

  receiveData(from: string, id: number, protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    const conns = this.conns.get(from);
    if (!conns) {
      // emit error
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      // emit error
      return;
    }
    conn.receiveData(protocol, data);
  }

  newStream(to: string, id: number, protocol: string) {
    if (this.aborted) {
      return;
    }
    this.service.newStream(this.peerId.toB58String(), to, id, protocol);
  }

  onNewStream(from: string, id: number, protocol: string) {
    if (this.aborted) {
      return;
    }
    const conns = this.conns.get(from);
    if (!conns) {
      // emit error
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      // emit error
      return;
    }
    const stream = conn.onNewStream(protocol);
    // TODO: handle
    const handler = this.handlers.get(protocol);
    if (!stream || !handler) {
      // emit error
      return;
    }
    // invoke callback
    handler({ connection: conn, stream });
  }

  private async checkMaxConns() {
    while (this.connectionSize > this.maxConnections) {
      const entries = Array.from(this.peerValues).sort(([, a], [, b]) => a - b);
      for (const [peer] of entries) {
        if (this.conns.has(peer)) {
          const conn = this.conns.get(peer)![0];
          await this.disconnect(peer, conn.id);
          break;
        } else {
          this.peerValues.delete(peer);
        }
      }
    }
  }

  private async _newConn(peer: string, id: number) {
    const peerId = PeerId.createFromB58String(peer);
    const conn = new MockConn(this, peerId, id);
    const conns = this.conns.get(peer);
    if (conns) {
      conns.push(conn);
    } else {
      this.conns.set(peer, [conn]);
    }
    this.emit('connect', conn);
    await this.checkMaxConns();
    return conn;
  }

  async dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    if (this.aborted) {
      throw new Error('libp2p aborted');
    }
    // NOTE: currently only string type and PeerId type is supported
    peer = peer as string | PeerId;
    if (peer instanceof PeerId) {
      peer = peer.toB58String();
    }
    if (this.conns.has(peer)) {
      return this.conns.get(peer)![0];
    }
    const addresses = this.addressBook.get(peer);
    if (!addresses) {
      throw new Error('missing address');
    }
    const id = await this.service.dial(this.peerId.toB58String(), peer, addresses);
    return await this._newConn(peer, id);
  }

  async onDial(from: string, id: number) {
    await this._newConn(from, id);
  }

  // TODO: support conn
  private async _disconnect(peer: string, id: number) {
    const conns = this.conns.get(peer);
    if (!conns) {
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      // emit error
      return;
    }
    await conn.close();
    this.emit('disconnect', conn);
    conns.splice(conns.indexOf(conn), 1);
    if (conns.length === 0) {
      this.conns.delete(peer);
    }
  }

  async disconnect(peer: string, id: number) {
    await this._disconnect(peer, id);
    await this.service.disconnect(this.peerId.toB58String(), peer, id);
  }

  async onDisconnect(from: string, id: number) {
    await this._disconnect(from, id);
  }

  handle(protocols: string | string[], callback: Handler): void {
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.handlers.set(protocols, callback);
  }

  unhandle(protocols: string | string[]): void {
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.handlers.delete(protocols);
  }

  addAddress(peerId: PeerId, addresses: Multiaddr[]): void {
    const oldAddrs = this.addressBook.get(peerId.toB58String()) || [];
    oldAddrs.forEach((addr) => {
      if (!addresses.find((r) => r.equals(addr))) {
        addresses.push(addr);
      }
    });
    if (addresses.length !== oldAddrs.length) {
      this.addressBook.set(peerId.toB58String(), addresses);
    }
    if (oldAddrs.length === 0) {
      this.emit('discovery', peerId);
    }
  }

  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.addressBook.get(peerId.toB58String());
  }

  removeAddress(peerId: PeerId): boolean {
    return this.addressBook.delete(peerId.toB58String());
  }

  async hangUp(peerId: string | PeerId): Promise<void> {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    const conns = this.conns.get(peerId);
    if (!conns) {
      return;
    }
    for (const conn of conns) {
      await this.disconnect(peerId, conn.id);
    }
  }

  setPeerValue(peerId: string | PeerId, value: number): void {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    this.peerValues.set(peerId, value);
  }

  setAnnounce(addresses: Multiaddr[]): void {
    this.announce = new Set<Multiaddr>(addresses);
  }

  getConnections(peerId: string): Connection[] | undefined {
    return this.conns.get(peerId);
  }

  private onPeer = ({ id, multiaddrs }: { id: PeerId; multiaddrs: Multiaddr[] }) => {
    if (this.aborted) {
      return;
    }
    this.addAddress(id, multiaddrs);
  };

  async start(): Promise<void> {
    this.discv5.on('peer', this.onPeer);
  }

  async stop(): Promise<void> {
    this.discv5.off('peer', this.onPeer);
    for (const peer of this.conns.keys()) {
      await this.hangUp(peer);
    }
  }
}

type MockDiscv5Config = {
  findNodesInterval: number;
  pingInterval: number;
  maxFindNodes: number;
};

function copyENR(enr: ENR) {
  return ENR.decodeTxt(enr.encodeTxt());
}

class MockDiscv5 extends EventEmitter implements IDiscv5 {
  config: MockDiscv5Config;
  keyPair: IKeypair;

  private aborted = false;
  private enr: ENR;
  private service: Service;
  private kbucket = new Map<string, ENR>();
  private pending: ENR[] = [];
  private findNodesTimer = new AbortableTimer();
  private pingTimer = new AbortableTimer();
  private findNodesPromise?: Promise<void>;
  private pingPromise?: Promise<void>;

  constructor(service: Service, enr: ENR, keyPair: IKeypair, config: MockDiscv5Config) {
    super();
    this.enr = enr;
    this.keyPair = keyPair;
    this.config = config;
    this.service = service;
  }

  private async findNodesLoop() {
    while (!this.aborted) {
      for (const to of this.kbucket.keys()) {
        const enrs = this.service.findNodes(this.enr.nodeId, to);
        for (const enr of enrs) {
          await this.handleEnr(enr);
        }
      }
      await this.findNodesTimer.wait(this.config.findNodesInterval);
    }
  }

  private async pingLoop() {
    while (!this.aborted) {
      // send a ping package to all peers in kbucket
      for (const enr of this.kbucket.values()) {
        this.service.ping(copyENR(this.enr), enr);
      }
      // send a ping package to all pending peers
      for (const enr of this.pending) {
        this.service.ping(copyENR(this.enr), enr);
      }
      await this.pingTimer.wait(this.config.pingInterval);
    }
  }

  private async handleEnr(enr: ENR) {
    if (enr.nodeId === this.enr.nodeId) {
      // ignore ourself
      return;
    }
    const oldENR = this.kbucket.get(enr.nodeId);
    if (!oldENR || enr.seq > oldENR.seq) {
      this.kbucket.set(enr.nodeId, enr);
    }
    const addr = enr.getLocationMultiaddr('tcp');
    if (!addr) {
      return;
    }
    this.emit('peer', {
      id: await enr.peerId(),
      multiaddrs: [addr]
    });
  }

  onPing(from: ENR, fromIP: string) {
    const oldENR = this.kbucket.get(from.nodeId);
    if (!oldENR) {
      // the remote peer doesn't exist,
      // add the new peer to pending list
      const index = this.pending.findIndex(({ nodeId }) => nodeId === from.nodeId);
      if (index !== -1) {
        this.pending.splice(index, 1);
      }
      this.pending.push(from);
    } else if (from.seq > oldENR.seq) {
      // update local enr address
      this.kbucket.set(from.nodeId, from);
    }
    // send a pong package to remote peer
    this.service.pong(copyENR(this.enr), from, fromIP);
  }

  onPong(from: ENR, realIP: string) {
    const index = this.pending.findIndex(({ nodeId }) => nodeId === from.nodeId);
    if (index !== -1) {
      // remove peer from pending list
      this.pending.splice(index, 1);
      // add the new peer to kbucket
      this.kbucket.set(from.nodeId, from);
    }
    // ignore unknown pong package
    if (!this.kbucket.has(from.nodeId)) {
      return;
    }
    // update local enr address
    if (realIP !== this.enr.ip) {
      this.enr.ip = realIP;
      this.emit('multiaddrUpdated', this.enr.getLocationMultiaddr('udp'));
    }
  }

  onFindNodes(from: string) {
    const enrs = [this.enr, ...Array.from(this.kbucket.values()).filter(({ nodeId }) => nodeId !== from)];
    if (enrs.length <= this.config.maxFindNodes) {
      return enrs.map(copyENR);
    }
    const results: ENR[] = [];
    while (results.length < this.config.maxFindNodes) {
      const index = getRandomIntInclusive(0, enrs.length - 1);
      results.push(enrs[index]);
      enrs.splice(index, 1);
    }
    return results.map(copyENR);
  }

  get localEnr(): ENR {
    return this.enr;
  }

  asyncAddEnr(enr: string | ENR) {
    enr = enr instanceof ENR ? copyENR(enr) : ENR.decodeTxt(enr);
    this.kbucket.set(enr.nodeId, enr);
    return this.handleEnr(enr);
  }

  addEnr(enr: string | ENR): void {
    this.asyncAddEnr(enr);
  }

  findEnr(nodeId: string): ENR | undefined {
    return this.kbucket.get(nodeId);
  }

  start(): void {
    this.findNodesPromise = this.findNodesLoop();
    this.pingPromise = this.pingLoop();
  }

  async abort() {
    if (!this.aborted) {
      this.aborted = true;
      this.findNodesTimer.abort();
      this.pingTimer.abort();
      await this.findNodesPromise;
      await this.pingPromise;
    }
  }

  stop(): void {
    this.abort();
  }
}

export type Endpoint = {
  network: NetworkManager;
  libp2p: MockLibp2p;
  discv5: MockDiscv5;
};

function defaultMockLibp2pConfig(): MockLibp2pConfig {
  return {
    maxPeers: 10
  };
}

function defaultMockDiscv5Config(): MockDiscv5Config {
  return {
    findNodesInterval: 50,
    pingInterval: 100,
    maxFindNodes: 16
  };
}

const localhost = '127.0.0.1';
const tcpPort = 4191;
const udpPort = 9810;

export class Service {
  private autoIP = 0;
  private autoConnId = 0;
  private peers = new Map<string, Endpoint>();
  private nodes = new Map<string, Endpoint>();
  private peersRealIP = new Map<string, string>();
  private nodesRealIP = new Map<string, string>();

  get endpoints() {
    return Array.from(this.peers.values());
  }

  setRealIP(peerId: string, nodeId: string, ip: string) {
    this.peersRealIP.set(peerId, ip);
    this.nodesRealIP.set(nodeId, ip);
  }

  deleteRealIP(peerId: string, nodeId: string) {
    this.peersRealIP.delete(peerId);
    this.nodesRealIP.delete(nodeId);
  }

  private generateIP() {
    const ip = this.autoIP++;
    if (ip > 255) {
      throw new Error('too many peers');
    }
    return `192.168.0.${ip}`;
  }

  async createEndpoint(bootnodes: string[] = [], local: boolean = false) {
    // create peer id
    const peerId = await PeerId.create({ keyType: 'secp256k1' });
    // create keypaire
    const keypair = createKeypairFromPeerId(peerId);
    // alloc real ip
    const realIP = this.generateIP();
    // init enr
    const enr = ENR.createV4(keypair.publicKey);
    enr.ip = local ? localhost : realIP;
    enr.tcp = tcpPort;
    enr.udp = udpPort;
    enr.encode(keypair.privateKey);
    // create network manager instance
    const discv5 = new MockDiscv5(this, enr, keypair, defaultMockDiscv5Config());
    const libp2p = new MockLibp2p(this, discv5, peerId, defaultMockLibp2pConfig());
    const network = new NetworkManager({
      peerId,
      // TODO: protocol
      protocols: [],
      nodedb: levelup(memdown()),
      discv5,
      libp2p
    });
    const ep = { network, libp2p, discv5 };
    // save to memory set
    this.peers.set(peerId.toB58String(), ep);
    this.nodes.set(enr.nodeId, ep);
    this.peersRealIP.set(peerId.toB58String(), realIP);
    this.nodesRealIP.set(enr.nodeId, realIP);
    // startup
    await network.init();
    await network.start();
    // add bootnodes
    for (const bootnode of bootnodes) {
      await discv5.asyncAddEnr(bootnode);
    }
    return ep;
  }

  sendData(from: string, to: string, id: number, protocol: string, data: Buffer) {
    const ep = this.peers.get(to);
    if (!ep) {
      // emit error
      return;
    }
    ep.libp2p.receiveData(from, id, protocol, data);
  }

  newStream(from: string, to: string, id: number, protocol: string) {
    const ep = this.peers.get(to);
    if (!ep) {
      throw new Error('missing remote peer');
    }
    ep.libp2p.onNewStream(from, id, protocol);
  }

  async dial(from: string, to: string, addresses: Multiaddr[]) {
    const ep = this.peers.get(to);
    if (!ep) {
      throw new Error('missing remote peer');
    }
    if (
      !addresses.find((addr) => {
        const nodeAddr = addr.nodeAddress();
        return (nodeAddr.family === 'IPv4' || (nodeAddr.family as any) === 4) && nodeAddr.address === this.peersRealIP.get(to) && (nodeAddr.port === tcpPort.toString() || (nodeAddr.port as any) === tcpPort);
      })
    ) {
      throw new Error('invalid multi address');
    }
    const connId = this.autoConnId++;
    await ep.libp2p.onDial(from, connId);
    return connId;
  }

  async disconnect(from: string, to: string, id: number) {
    const ep = this.peers.get(to);
    if (!ep) {
      throw new Error('missing remote peer');
    }
    await ep.libp2p.onDisconnect(from, id);
  }

  findNodes(from: string, to: string) {
    const ep = this.nodes.get(to);
    if (!ep) {
      return [];
    }
    return ep.discv5.onFindNodes(from);
  }

  ping(from: ENR, to: ENR) {
    const ep = this.nodes.get(to.nodeId);
    if (!ep) {
      return;
    }
    const realToIP = this.nodesRealIP.get(to.nodeId);
    if (!realToIP || realToIP !== to.ip) {
      return;
    }
    ep.discv5.onPing(from, this.nodesRealIP.get(from.nodeId) ?? from.ip!);
  }

  pong(from: ENR, to: ENR, realIP: string) {
    const ep = this.nodes.get(to.nodeId);
    if (!ep) {
      return;
    }
    ep.discv5.onPong(from, realIP);
  }

  async abort() {
    for (const { network } of this.peers.values()) {
      await network.abort();
    }
  }
}
