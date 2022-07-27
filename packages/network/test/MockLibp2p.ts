import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId, IKeypair } from '@gxchain2/discv5/lib/keypair';
import { MockDiscv5 } from './MockDiscv5';
import { MockWholeNetwork2 } from './MockWholenet';
import { Libp2pNodeOptions } from '../src/libp2pImpl';
import { Connection, ILibp2p, Stream } from '../src';
import { testChannel } from './testChannel';
export class MockStream extends EventEmitter {
  public sendChannel: testChannel<{ _bufs: Buffer[] }> | undefined;
  public reciveChannel: testChannel<{ _bufs: Buffer[] }>;
  private abort: boolean = false;
  constructor(reciveChannel: testChannel<{ _bufs: Buffer[] }>) {
    super();
    this.reciveChannel = reciveChannel;
  }
  async sink(source: AsyncGenerator<Buffer>): Promise<void> {
    //local data send
    while (true && !this.abort) {
      const { value } = await source.next();
      if (value !== undefined) {
        this.sendChannel?.send(value);
      } else {
        return;
      }
    }
  }
  source(): AsyncGenerator<{ _bufs: Buffer[] }> {
    //remote data recive
    return this.reciveChannel.data();
  }
  setSendChannel(channel: testChannel<{ _bufs: Buffer[] }>) {
    this.sendChannel = channel;
  }
  close() {
    this.abort = true;
    this.reciveChannel.close();
    this.emit('close');
  }
}

export class MockConnection extends EventEmitter {
  id: number;
  mockLibp2p: ILibp2p;
  remotePeer: PeerId;
  streams: Map<string, MockStream> = new Map();
  direction: 'inbound' | 'outbound';
  constructor(peerId: PeerId, direction: 'inbound' | 'outbound', libp2p: ILibp2p) {
    super();
    this.id = Date.now();
    this.remotePeer = peerId;
    this.direction = direction;
    this.mockLibp2p = libp2p;
  }

  async close(): Promise<void> {
    Array.from(this.streams.values()).map((s) => s.close());
    this.emit('close');
    this.mockLibp2p.emit('disconnect', this);
    return;
  }

  async newStream(protocols: string | string[]): Promise<{ stream: Stream }> {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    let stream = this.streams.get(protocols[0]);
    if (!stream) {
      let channel = new testChannel<{ _bufs: Buffer[] }>();
      stream = new MockStream(channel);
      stream.on('close', () => {
        this.streams.delete(protocols[0]);
        this.emit('closeStream', protocols[0]); //notice wholeNetwork
      });
      this.streams.set(protocols[0], stream);
      this.emit('newStream', protocols[0], channel, stream); //notice wholeNetwork
      this.mockLibp2p.emit('newStream', protocols[0], this, stream);
    }
    return { stream };
  }

  _getStreams(): Stream[] {
    return Array.from(this.streams.values());
  }

  inboundStreams(protocol: string, channel: testChannel<{ _bufs: Buffer[] }>) {
    let stream = this.streams.get(protocol);
    if (!stream) {
      let c = new testChannel<{ _bufs: Buffer[] }>();
      stream = new MockStream(c);
      stream.setSendChannel(channel);
      this.streams.set(protocol, stream);
      this.mockLibp2p.emit('newStream', protocol, this, stream);
      return stream;
    } else {
      return stream;
    }
  }
  closeStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.close();
      this.streams.delete(protocol);
    }
  }
}

export class MockLibp2p extends EventEmitter implements ILibp2p {
  id: PeerId;
  enr: ENR;
  discv5: MockDiscv5;
  udpPort: number;
  tcpPort: number;
  maxConntionSize: number;
  announce: Set<string> = new Set();
  peers: Map<string, Multiaddr[]> = new Map();
  connections: Map<string, MockConnection[]> = new Map();
  peerValues: Map<string, number> = new Map();
  protocols: Map<string, (input: { connection: Connection; stream: Stream }) => void> = new Map();
  libp2pConfig: Libp2pNodeOptions;
  wholeNetwork: MockWholeNetwork2;
  abort: boolean = false;
  constructor(config: Libp2pNodeOptions, discv5: MockDiscv5, wholeNetwork: MockWholeNetwork2) {
    super();
    this.wholeNetwork = wholeNetwork;
    this.id = config.peerId;
    this.libp2pConfig = config;
    this.enr = config.enr;
    this.maxConntionSize = config.maxConnections ? config.maxConnections : 50;
    this.udpPort = config.udpPort ? config.udpPort : 9527;
    this.tcpPort = config.tcpPort ? config.tcpPort : 9528;
    this.discv5 = discv5;
    this.discv5.on('peer', ({ id, multiaddrs }) => {
      this.addAddress(id, multiaddrs);
    });
    wholeNetwork.registerPeer(this);
  }

  get peerId(): PeerId {
    return this.id;
  }

  get maxConnections(): number {
    return this.libp2pConfig.maxConnections ?? 50;
  }

  get connectionSize(): number {
    return Array.from(this.connections.values()).reduce((accumulator, value) => accumulator + value.length, 0);
  }

  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocols.set(protocol, callback);
    });
  }

  unhandle(protocols: string | string[]): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocols.delete(protocol);
    });
  }

  addAddress(peerId: PeerId, addresses: Multiaddr[]): void {
    this.peers.set(peerId.toB58String(), addresses);
    this.emit('peer:discovery', peerId);
  }

  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.peers.get(peerId.toB58String());
  }

  async dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    if (peer instanceof Multiaddr) {
      return undefined as any;
    }
    if (peer instanceof PeerId) {
      peer = peer.toB58String();
    }
    let connection: MockConnection;
    const connections = this.connections.get(peer);
    if (connections) {
      connection = connections[0];
    } else {
      connection = this.wholeNetwork.toConnect(this, peer);
    }
    return connection;
  }

  async hangUp(peerId: string | PeerId): Promise<void> {
    if (peerId instanceof PeerId) {
      peerId = await peerId.toB58String();
    }
    const connections = this.connections.get(peerId);
    if (!connections) {
      return;
    }
    await Promise.all(connections.map((c) => c.close()));
  }

  setPeerValue(peerId: string | PeerId, value: number): void {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    this.peerValues.set(peerId, value);
  }

  setAnnounce(addresses: Multiaddr[]): void {
    this.announce = new Set(addresses.map((addr) => addr.toString()));
  }

  getConnections(peerId: string): Connection[] | undefined {
    return this.connections.get(peerId);
  }

  async start(): Promise<void> {
    this.on('connect', (connection: MockConnection) => {
      const peerId = connection.remotePeer.toB58String();
      if (!this.connections.has(peerId)) {
        this.connections.set(peerId, [connection]);
      } else {
        this.connections.get(peerId)!.push(connection);
      }
      this.emit('peer:connect', connection);
      this.checkMaxLimit();
    });
    this.on('disconnect', (connection: MockConnection) => {
      const peerId = connection.remotePeer.toB58String();
      let storedConn = this.connections.get(peerId);
      if (storedConn && storedConn.length > 1) {
        storedConn = storedConn.filter((conn) => conn.id !== connection.id);
        this.connections.set(peerId, storedConn);
      } else if (storedConn) {
        this.connections.delete(peerId);
        this.peerValues.delete(connection.remotePeer.toB58String());
        this.emit('peer:disconnect', connection);
      }
    });
    this.on('newStream', (protocol: string, connection: MockConnection, stream: MockStream) => {
      const callback = this.protocols.get(protocol);
      if (callback) {
        callback({ connection, stream });
      }
    });
  }

  async stop(): Promise<void> {
    this.abort = true;
    this.removeAllListeners();
    const tasks: any[] = [];
    for (const connectionList of this.connections.values()) {
      for (const connection of connectionList) {
        tasks.push(connection.close());
      }
    }
    await tasks;
    this.connections.clear();
    return;
  }

  private checkMaxLimit() {
    if (this.connectionSize >= this.maxConnections) {
      const peerValues = Array.from(this.peerValues).sort((a, b) => a[1] - b[1]);
      const disconnectPeer = peerValues[0];
      if (disconnectPeer) {
        const peerId = disconnectPeer[0];
        for (const connections of this.connections.values()) {
          if (connections[0].remotePeer.toB58String() === peerId) {
            connections[0].close();
            break;
          }
        }
      }
    }
  }
}

async function createNode(w: MockWholeNetwork2, bootNode: ENR[], options: { nat?: string; tcpPort?: number; udpPort?: number }) {
  const peerId = await PeerId.create({ keyType: 'secp256k1' });
  const keypair = createKeypairFromPeerId(peerId);
  let enr = ENR.createV4(keypair.publicKey);
  if (options.nat === undefined || v4(options.nat)) {
    enr.ip = options.nat ?? '127.0.0.1';
    enr.tcp = options.tcpPort ?? 4191;
    enr.udp = options.udpPort ?? 9810;
  } else if (options.nat !== undefined && v6(options.nat)) {
    throw new Error('IPv6 is currently not supported');
  } else {
    throw new Error('invalid ip address: ' + options.nat);
  }
  // update enr seq
  enr.seq = BigInt(Date.now());
  enr.encode(keypair.privateKey);
  const discv5 = new MockDiscv5(keypair, enr, bootNode, w);
  discv5.start();
  const libp2p = new MockLibp2p({ peerId, enr, udpPort: options.udpPort, tcpPort: options.tcpPort, maxConnections: 50 }, discv5, w);
  libp2p.start();
  return { discv5, libp2p };
}

async function main() {
  const w = new MockWholeNetwork2();
  let tcpPort = 4191;
  let udpPort = 9810;
  let nat = '192.168.0.4';
  let list: Promise<{ discv5: MockDiscv5; libp2p: MockLibp2p }>[] = [];
  const bootNode = await createNode(w, [], { nat, tcpPort, udpPort });
  for (let i = 0; i < 10; i++) {
    tcpPort += 1;
    udpPort += 1;
    const node = createNode(w, [bootNode.discv5.localEnr], { tcpPort, udpPort });
    list.push(node);
  }
  const nodes = [bootNode, ...(await Promise.all(list))];
  for (const node of nodes) {
    node.discv5.on('multiaddrUpdated', () => {
      node.discv5.sign();
    });
  }
  const p1 = nodes[0];
  const p2 = nodes[1];
  p1.libp2p.on('peer:connect', (connection) => {
    console.log('p1 : ', p1.libp2p.peerId.toB58String(), 'connection from', connection.remotePeer.toB58String());
  });
  p1.libp2p.on('peer:disconnect', (connection) => {
    console.log('p1 : ', p1.libp2p.peerId.toB58String(), ' disconnection from', connection.remotePeer.toB58String());
  });
  p2.libp2p.on('peer:connect', (connection) => {
    console.log('p2 : ', p2.libp2p.peerId.toB58String(), 'connection from', connection.remotePeer.toB58String());
  });
  p2.libp2p.on('peer:disconnect', (connection) => {
    console.log('p2 : ', p2.libp2p.peerId.toB58String(), ' disconnection from', connection.remotePeer.toB58String());
  });

  p1.libp2p.handle('sayHi', (input) => {
    const dataChannel = new testChannel<Buffer>();
    input.stream.sink(dataChannel.data());
    setInterval(() => {
      dataChannel.send(Buffer.from('hello'));
    }, 1000);
    console.log('p1 install sayHi protocol');
  });

  p2.libp2p.handle('sayHi', async (input) => {
    const dataSouce = input.stream.source();
    while (true) {
      const data = await dataSouce.next();
      if (data.done) {
        break;
      }
      console.log('p2 receive data: ', data.value.toString());
    }
  });
  const connect = await p1.libp2p.dial(p2.libp2p.peerId.toB58String());
  const stream = (await connect.newStream('sayHi')).stream;
  setTimeout(() => {
    connect.close();
  }, 10000);
}

main();
