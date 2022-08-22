import crypto from 'crypto';
import EventEmitter from 'events';
import levelup from 'levelup';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { ENR, IKeypair, createKeypairFromPeerId } from '@gxchain2/discv5';
import { Channel, AbortableTimer, getRandomIntInclusive } from '@rei-network/utils';
import { Connection, Stream, ILibp2p, IDiscv5 } from '../src/types';
import { NetworkManager, Peer, Protocol, ProtocolHandler, ProtocolStream } from '../src';

const memdown = require('memdown');

// generate handshake message
function handshake(version: number) {
  return Buffer.from(JSON.stringify({ method: 'handshake', version }));
}

// generate request message
function request(version: number) {
  return Buffer.from(JSON.stringify({ method: 'request', version }));
}

// generate response message
function response(version: number) {
  return Buffer.from(JSON.stringify({ method: 'response', version }));
}

class MockHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly stream: ProtocolStream;
  readonly protocol: MockProtocol;

  private handshakeTimer?: NodeJS.Timeout;
  private handshakeResolve?: (result: boolean) => void;
  private requestTimer?: NodeJS.Timeout;
  private requestResolve?: (result: boolean) => void;

  constructor(protocol: MockProtocol, peer: Peer, stream: ProtocolStream) {
    this.peer = peer;
    this.stream = stream;
    this.protocol = protocol;
  }

  // clear handshake info
  private clearHandshake() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
    if (this.handshakeResolve) {
      this.handshakeResolve(false);
      this.handshakeResolve = undefined;
    }
  }

  // clear request info
  private clearRequest() {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer);
      this.requestTimer = undefined;
    }
    if (this.requestResolve) {
      this.requestResolve(false);
      this.requestResolve = undefined;
    }
  }

  /**
   * Handshake with remote peer,
   * send handshake message immediately
   * and wait for remote response
   * @returns Whether succeed
   */
  handshake(): boolean | Promise<boolean> {
    if (this.handshakeResolve) {
      throw new Error('invalid handshake');
    }
    this.stream.send(handshake(this.protocol.version));
    return new Promise<boolean>((resolve) => {
      this.handshakeTimer = setTimeout(() => {
        resolve(false);
      }, 1000);
      this.handshakeResolve = resolve;
    }).finally(() => {
      this.clearHandshake();
    });
  }

  /**
   * Handle remote message
   * @param data - Message data
   */
  handle(data: Buffer): void | Promise<void> {
    const { method, version, params } = JSON.parse(data.toString());
    if (version !== this.protocol.version) {
      throw new Error('invalid vesion');
    }
    if (method === 'handshake') {
      if (this.handshakeResolve) {
        this.handshakeResolve(true);
      }
    } else if (method === 'request') {
      this.stream.send(response(this.protocol.version));
    } else if (method === 'response') {
      if (this.requestResolve) {
        this.requestResolve(params);
      }
    }
  }

  /**
   * Send request to remote peer
   * and wait for response
   * @returns Whether succeed
   */
  request() {
    if (this.requestResolve) {
      throw new Error('invalid request');
    }
    this.stream.send(request(this.protocol.version));
    return new Promise<boolean>((resolve) => {
      this.requestTimer = setTimeout(() => {
        resolve(false);
      }, 1000);
      this.requestResolve = resolve;
    }).finally(() => {
      this.clearRequest();
    });
  }

  /**
   * Abort handler
   */
  abort() {
    this.clearHandshake();
    this.clearRequest();
  }
}

export class MockProtocol implements Protocol {
  readonly version: number;

  constructor(version: number) {
    this.version = version;
  }

  get protocolString() {
    return `mock-protocol/${this.version}`;
  }

  /**
   * Create handler for remote peer
   * @param peer - Peer object
   * @param stream - Stream object
   * @returns New handler object
   */
  async makeHandler(peer: Peer, stream: ProtocolStream): Promise<ProtocolHandler | null> {
    return new MockHandler(this, peer, stream);
  }
}

class MockStream implements Stream {
  private aborted: boolean = false;
  private conn: MockConn;
  private protocol: string;
  private output = new Channel<Buffer>();

  constructor(conn: MockConn, protocol: string) {
    this.conn = conn;
    this.protocol = protocol;
  }

  /**
   * Close stream,
   * This method only cares about itself and does not close the remote stream
   */
  close(): void {
    if (!this.aborted) {
      this.aborted = true;
      this.output.abort();
    }
  }

  /**
   * Receive data from remote stream
   * @param data
   */
  receiveData(data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.output.push(data);
  }

  /**
   * Read data from local source stream
   * and send them to remote
   * @param source - Source stream
   */
  sink = async (source: AsyncGenerator<Buffer, any, unknown>): Promise<void> => {
    for await (const data of source) {
      if (this.aborted) {
        break;
      }
      this.conn.sendData(this.protocol, data);
    }
  };

  /**
   * Receive data from remote stream
   */
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

  /**
   * Send data to remote connection
   * @param protocol
   * @param data
   */
  sendData(protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.libp2p.sendData(this.remotePeer.toB58String(), this.id, protocol, data);
  }

  /**
   * Receive data from remote connection
   * @param protocol
   * @param data
   */
  receiveData(protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    const stream = this.streams.get(protocol);
    if (!stream) {
      return;
    }
    stream.receiveData(data);
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (!this.aborted) {
      this.aborted = true;
      for (const stream of this.streams.values()) {
        stream.close();
      }
      this.streams.clear();
    }
  }

  // create a new stream for protocol
  private _newStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.close();
    }
    stream = new MockStream(this, protocol);
    this.streams.set(protocol, stream);
    return stream;
  }

  /**
   * Create a new stream for protocol
   * @param protocols
   * @returns New stream
   */
  async newStream(protocols: string | string[]): Promise<{ stream: Stream }> {
    if (this.aborted) {
      throw new Error('stream closed');
    }
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.libp2p.newStream(this.remotePeer.toB58String(), this.id, protocols);
    return { stream: this._newStream(protocols) };
  }

  /**
   * Receive new streaming request from remote
   * @param protocol
   * @returns New stream
   */
  onNewStream(protocol: string) {
    if (this.aborted) {
      return;
    }
    return this._newStream(protocol);
  }

  /**
   * Get local streams
   * @returns Streams
   */
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

  /**
   * Send data to remote libp2p
   * @param to - Peer id
   * @param id - Connection id
   * @param protocol - Protocol name
   * @param data - Data
   */
  sendData(to: string, id: number, protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    this.service.sendData(this.peerId.toB58String(), to, id, protocol, data);
  }

  /**
   * Receive data from remote libp2p
   * @param from - Remote peer id
   * @param id - Connection id
   * @param protocol - Protocol nam
   * @param data - Data
   */
  receiveData(from: string, id: number, protocol: string, data: Buffer) {
    if (this.aborted) {
      return;
    }
    const conns = this.conns.get(from);
    if (!conns) {
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      return;
    }
    conn.receiveData(protocol, data);
  }

  /**
   * Create new stream for protocol
   * @param to - Peer id
   * @param id - Connection id
   * @param protocol - Protocol name
   */
  newStream(to: string, id: number, protocol: string) {
    if (this.aborted) {
      return;
    }
    this.service.newStream(this.peerId.toB58String(), to, id, protocol);
  }

  /**
   * Receive new streaming requst from remote
   * @param from - Remote peer id
   * @param id - Connection id
   * @param protocol - Protocol name
   */
  onNewStream(from: string, id: number, protocol: string) {
    if (this.aborted) {
      return;
    }
    const conns = this.conns.get(from);
    if (!conns) {
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      return;
    }
    const stream = conn.onNewStream(protocol);
    const handler = this.handlers.get(protocol);
    if (!stream || !handler) {
      return;
    }
    // invoke callback
    handler({ connection: conn, stream });
  }

  // check if the number of connections exceeds the maximum limit
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

  // create a new connection
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

  /**
   * Dial a remote node
   * @param peer - Remote peer id
   * @returns Connection object
   */
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

  /**
   * Receive dialing request from remote
   * @param from - Remote peer id
   * @param id - Connection id
   */
  async onDial(from: string, id: number) {
    await this._newConn(from, id);
  }

  // TODO: support conn?
  // close a connection
  private async _disconnect(peer: string, id: number) {
    const conns = this.conns.get(peer);
    if (!conns) {
      return;
    }
    const conn = conns.find(({ id: _id }) => id === _id);
    if (!conn) {
      return;
    }
    await conn.close();
    this.emit('disconnect', conn);
    conns.splice(conns.indexOf(conn), 1);
    if (conns.length === 0) {
      this.conns.delete(peer);
    }
  }

  /**
   * Close a connection
   * @param peer - Peer id
   * @param id - Connection id
   */
  async disconnect(peer: string, id: number) {
    await this._disconnect(peer, id);
    await this.service.disconnect(this.peerId.toB58String(), peer, id);
  }

  /**
   * Receive closing connection request from remote
   * @param from - Remote peer id
   * @param id - Connection id
   */
  async onDisconnect(from: string, id: number) {
    await this._disconnect(from, id);
  }

  // register handler
  handle(protocols: string | string[], callback: Handler): void {
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.handlers.set(protocols, callback);
  }

  // unregister handler
  unhandle(protocols: string | string[]): void {
    // NOTE: currently only string type is supported
    protocols = protocols as string;
    this.handlers.delete(protocols);
  }

  // add address to address book
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

  // get address from address book
  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.addressBook.get(peerId.toB58String());
  }

  // remote peer from address book
  removeAddress(peerId: PeerId): boolean {
    return this.addressBook.delete(peerId.toB58String());
  }

  // disconnect with special peer
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

  // set peer value
  setPeerValue(peerId: string | PeerId, value: number): void {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    this.peerValues.set(peerId, value);
  }

  // set announcement addresses
  setAnnounce(addresses: Multiaddr[]): void {
    this.announce = new Set<Multiaddr>(addresses);
  }

  // get connections by peer
  getConnections(peerId: string): Connection[] | undefined {
    return this.conns.get(peerId);
  }

  // handle discv5 `peer` event
  private onPeer = ({ id, multiaddrs }: { id: PeerId; multiaddrs: Multiaddr[] }) => {
    if (this.aborted) {
      return;
    }
    this.addAddress(id, multiaddrs);
  };

  // start libp2p
  async start(): Promise<void> {
    this.discv5.on('peer', this.onPeer);
  }

  // stop libp2p
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
  // a pending list for new peers
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

  /**
   * Handle an new ENR address,
   * add it to kbucket and emit `peer` event
   * @param enr - ENR address
   */
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

  /**
   * Receive ping package from remote
   * @param from - Remote node id
   * @param fromIP - Remote ip address
   */
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
      this.handleEnr(from);
    }
    // send a pong package to remote peer
    this.service.pong(copyENR(this.enr), from, fromIP);
  }

  /**
   * Receive pong package from remote
   * @param from - Remote node id
   * @param realIP - Real ip of local node
   */
  onPong(from: ENR, realIP: string) {
    const index = this.pending.findIndex(({ nodeId }) => nodeId === from.nodeId);
    if (index !== -1) {
      // remove peer from pending list
      this.pending.splice(index, 1);
      // add the new peer to kbucket
      this.handleEnr(from);
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

  /**
   * Receive find nodes pacakge from remote
   * @param from - Remote node id
   * @returns Nodes
   */
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

  // add ENR address to kbucket
  asyncAddEnr(enr: string | ENR) {
    enr = enr instanceof ENR ? copyENR(enr) : ENR.decodeTxt(enr);
    this.kbucket.set(enr.nodeId, enr);
    return this.handleEnr(enr);
  }

  // add ENR address to kbucket
  addEnr(enr: string | ENR): void {
    this.asyncAddEnr(enr);
  }

  // get ENR address by node id
  findEnr(nodeId: string): ENR | undefined {
    return this.kbucket.get(nodeId);
  }

  // start discv5
  start(): void {
    this.findNodesPromise = this.findNodesLoop();
    this.pingPromise = this.pingLoop();
  }

  // abort discv5
  async abort() {
    if (!this.aborted) {
      this.aborted = true;
      this.findNodesTimer.abort();
      this.pingTimer.abort();
      await this.findNodesPromise;
      await this.pingPromise;
    }
  }

  // stop discv5
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
    findNodesInterval: 100,
    pingInterval: 200,
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

  /**
   * Set node real ip,
   * this will change the ip of the pong package
   * @param peerId - Peer id
   * @param nodeId - Node id
   * @param ip - Real ip
   */
  setRealIP(peerId: string, nodeId: string, ip: string) {
    this.peersRealIP.set(peerId, ip);
    this.nodesRealIP.set(nodeId, ip);
  }

  // generate unique ip address
  private generateIP() {
    const ip = this.autoIP++;
    if (ip > 255) {
      throw new Error('too many peers');
    }
    return `192.168.0.${ip}`;
  }

  /**
   * Create an new endpoint
   * @param bootnodes - Bootnodes list, it will be added to kbucket
   * @param local - Whether to use the localhost address instead of the real address
   * @returns New endpoint
   */
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

  /**
   * Send data
   * @param from - From peer id
   * @param to - To peer id
   * @param id - Connection id
   * @param protocol - Protocol name
   * @param data - Data
   */
  sendData(from: string, to: string, id: number, protocol: string, data: Buffer) {
    const ep = this.peers.get(to);
    if (!ep) {
      return;
    }
    ep.libp2p.receiveData(from, id, protocol, data);
  }

  /**
   * New stream
   * @param from - From peer id
   * @param to - To peer id
   * @param id - Connection id
   * @param protocol - Protocol name
   */
  newStream(from: string, to: string, id: number, protocol: string) {
    const ep = this.peers.get(to);
    if (!ep) {
      throw new Error('missing remote peer');
    }
    ep.libp2p.onNewStream(from, id, protocol);
  }

  /**
   * Dial a peer
   * @param from - From peer id
   * @param to - To peer id
   * @param addresses - Multi addresses
   * @returns Connection id
   */
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

  /**
   * Close a connections
   * @param from - From peer id
   * @param to - To peer id
   * @param id - Connection id
   */
  async disconnect(from: string, to: string, id: number) {
    const ep = this.peers.get(to);
    if (!ep) {
      throw new Error('missing remote peer');
    }
    await ep.libp2p.onDisconnect(from, id);
  }

  /**
   * Find nodes
   * @param from - From node id
   * @param to - To node id
   * @returns Nodes
   */
  findNodes(from: string, to: string) {
    const ep = this.nodes.get(to);
    if (!ep) {
      return [];
    }
    return ep.discv5.onFindNodes(from);
  }

  /**
   * Send ping package
   * @param from - From node id
   * @param to - To node id
   */
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

  /**
   * Send pong package
   * @param from - From node id
   * @param to - To node id
   * @param realIP - Real ip address
   */
  pong(from: ENR, to: ENR, realIP: string) {
    const ep = this.nodes.get(to.nodeId);
    if (!ep) {
      return;
    }
    ep.discv5.onPong(from, realIP);
  }

  /**
   * Abort service, close all network managers
   */
  async abort() {
    for (const { network } of this.peers.values()) {
      await network.abort();
    }
  }
}
