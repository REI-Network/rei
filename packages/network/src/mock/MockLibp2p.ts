import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr, { resolve } from 'multiaddr';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId, IKeypair } from '@gxchain2/discv5/lib/keypair';
import { MockDiscv5 } from './MockDiscv5';
import { MockWholeNetwork2 } from './MockWholenet';
import { Libp2pNodeOptions } from '../libp2pImpl';
import { Connection, IDiscv5, ILibp2p, Stream } from '../types';
import { testChannel } from './testChannel';
import { Channel } from '@rei-network/utils';
import { CheckMaxLimitMessage, ConnectionMessage, DiscoverMessage, StreamMessage } from './MockMessage';
import { Message } from '../messages';
export class MockStream extends EventEmitter {
  public sendChannel: testChannel<{ _bufs: Buffer[] }> | undefined;
  public reciveChannel: testChannel<{ _bufs: Buffer[] }>;
  private abort: boolean = false;
  constructor(reciveChannel: testChannel<{ _bufs: Buffer[] }>) {
    super();
    this.reciveChannel = reciveChannel;
  }

  sink = async (source: AsyncGenerator<Buffer>) => {
    //local data send
    while (true && !this.abort) {
      const { value } = await source.next();
      if (value !== undefined) {
        this.sendChannel?.send(value);
      } else {
        return;
      }
    }
  };

  source = () => {
    //remote data recive
    return this.reciveChannel.data();
  };

  close() {
    this.abort = true;
    this.reciveChannel.close();
    this.emit('close');
  }

  passiveClose() {
    this.abort = true;
    this.reciveChannel.close();
  }

  setSendChannel(channel: testChannel<{ _bufs: Buffer[] }>) {
    this.sendChannel = channel;
  }
}
let count = 0;
export class MockConnection extends EventEmitter {
  id: number;
  mockLibp2p: ILibp2p;
  remotePeer: PeerId;
  streams: Map<string, MockStream> = new Map();
  direction: 'inbound' | 'outbound';
  constructor(peerId: PeerId, direction: 'inbound' | 'outbound', libp2p: ILibp2p) {
    super();
    this.id = count++;
    this.remotePeer = peerId;
    this.direction = direction;
    this.mockLibp2p = libp2p;
  }

  async close(): Promise<void> {
    Array.from(this.streams.values()).map((s) => s.close());
    this.streams.clear();
    this.mockLibp2p.emit('mock:disconnect', this);
    this.emit('close'); //notice wholeNetwork
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
      this.mockLibp2p.emit('newStream', protocols[0], this, stream);
      this.emit('newStream', protocols[0], channel, stream); //notice wholeNetwork
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

  passiveClose() {
    Array.from(this.streams.values()).map((s) => s.passiveClose());
    this.streams.clear();
    this.mockLibp2p.emit('mock:disconnect', this);
    return;
  }

  passiveCloseStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.passiveClose();
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
  isStarted: boolean = false;
  private readonly channel = new Channel<Message>();
  private pengingClose: Set<string> = new Set();
  constructor(config: Libp2pNodeOptions, discv5: MockDiscv5, wholeNetwork: MockWholeNetwork2) {
    super();
    this.wholeNetwork = wholeNetwork;
    this.id = config.peerId;
    this.libp2pConfig = config;
    this.enr = config.enr;
    this.maxConntionSize = config.maxConnections ? config.maxConnections : 5;
    this.udpPort = config.udpPort ? config.udpPort : 9527;
    this.tcpPort = config.tcpPort ? config.tcpPort : 9528;
    this.discv5 = discv5;
    this.discv5.on('peer', ({ id, multiaddrs }) => {
      this.push(new DiscoverMessage(id, multiaddrs));
    });
    wholeNetwork.registerPeer(this);
  }

  get peerId(): PeerId {
    return this.id;
  }

  get maxConnections(): number {
    return this.maxConntionSize;
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
    const add = this.peers.get(peerId.toB58String()) || [];
    if (!add || add.toLocaleString() !== addresses.toLocaleString()) {
      this.peers.set(peerId.toB58String(), addresses);
      this.emit('discovery', peerId);
    }
  }

  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.peers.get(peerId.toB58String());
  }

  async dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    return new Promise((resolve) => {
      if (peer instanceof Multiaddr) {
        return undefined as any;
      }
      if (peer instanceof PeerId) {
        peer = peer.toB58String();
      }
      let connection: MockConnection;
      const connections = this.connections.get(peer);
      if (connections) {
        resolve(connections[0]);
      } else {
        this.wholeNetwork.toConnect(this.peerId.toB58String(), peer, resolve);
      }
    });
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
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;
    this.on('mock:connect', (connection: MockConnection) => {
      this.push(new ConnectionMessage(connection, true));
    });
    this.on('mock:disconnect', (connection: MockConnection) => {
      this.push(new ConnectionMessage(connection, false));
    });
    this.on('newStream', (protocol: string, connection: MockConnection, stream: MockStream) => {
      this.push(new StreamMessage(protocol, connection, stream));
    });
    this.loop();
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
    if (this.connectionSize - this.pengingClose.size >= this.maxConnections) {
      const peerValues = Array.from(this.peerValues).sort((a, b) => a[1] - b[1]);
      const disconnectPeer = peerValues[0];
      if (disconnectPeer) {
        const peerId = disconnectPeer[0];
        if (!this.connections.has(peerId)) {
          console.log(`[${this.peerId.toB58String()}] disconnect ${peerId}`);
          this.peerValues.delete(peerId);
          return;
        }
        if (this.pengingClose.has(peerId)) {
          return;
        }
        for (const connections of this.connections.values()) {
          if (connections[0].remotePeer.toB58String() === peerId) {
            connections[0].close();
            this.pengingClose.add(peerId);
            break;
          }
        }
      }
    }
  }

  private push(message: Message): void {
    this.channel.push(message);
  }

  private async loop() {
    for await (const message of this.channel) {
      if (message instanceof ConnectionMessage) {
        if (message.isConnect) {
          this.onConnction(message.connection);
        } else {
          this.onDisconnection(message.connection);
        }
      } else if (message instanceof StreamMessage) {
        this.onStream(message.protocol, message.connection, message.stream);
      } else if (message instanceof DiscoverMessage) {
        this.onDiscover({ id: message.peerId, multiaddrs: message.multiaddr });
      } else if (message instanceof CheckMaxLimitMessage) {
        this.checkMaxLimit();
      }
    }
  }

  private onConnction(connection: MockConnection) {
    const peerId = connection.remotePeer.toB58String();
    if (!this.connections.has(peerId)) {
      this.connections.set(peerId, [connection]);
    } else {
      this.connections.get(peerId)!.push(connection);
    }
    this.emit('connect', connection);
    // this.checkMaxLimit();
    this.push(new CheckMaxLimitMessage());
  }

  private onDisconnection(connection: MockConnection) {
    const peerId = connection.remotePeer.toB58String();
    if (this.pengingClose.has(peerId)) {
      this.pengingClose.delete(peerId);
    }
    let storedConn = this.connections.get(peerId);
    if (storedConn && storedConn.length > 1) {
      storedConn = storedConn.filter((conn) => conn.id !== connection.id);
      this.connections.set(peerId, storedConn);
    } else if (storedConn) {
      this.connections.delete(peerId);
      this.peerValues.delete(connection.remotePeer.toB58String());
      this.emit('disconnect', connection);
    }
  }

  private onStream(protocol: string, connection: MockConnection, stream: MockStream) {
    const callback = this.protocols.get(protocol);
    if (callback) {
      callback({ connection, stream });
    }
  }

  private onDiscover(peer: { id: PeerId; multiaddrs: [Multiaddr] }) {
    this.addAddress(peer.id, peer.multiaddrs);
  }
}

async function createNode(w: MockWholeNetwork2, bootNode: string[], options: { nat?: string; tcpPort?: number; udpPort?: number }) {
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
  const libp2p = new MockLibp2p({ peerId, enr, udpPort: options.udpPort, tcpPort: options.tcpPort, maxConnections: 50 }, discv5, w);
  discv5.start();
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
    const node = createNode(w, [bootNode.discv5.localEnr.encodeTxt()], { tcpPort, udpPort });
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

const w = new MockWholeNetwork2();
export function createMockImp(options: Libp2pNodeOptions): { libp2p: ILibp2p; discv5: IDiscv5 } {
  const discv5 = new MockDiscv5(createKeypairFromPeerId(options.peerId), options.enr, options.bootnodes ?? [], w);
  const libp2p = new MockLibp2p(options, discv5, w);
  return { libp2p, discv5 };
}
