import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { Connection, ILibp2p, Stream } from '../../src/types';
import { MockConnection } from './MockConnection';
import { NetworkService } from './NetworkService';
import { MockDiscv5 } from './MockDiscv5';
import { MockLibp2pConfig, defaultTcpPort } from './MockConfig';

export class MockLibp2p extends EventEmitter implements ILibp2p {
  //networkService instance
  private networkService: NetworkService;
  //peer weight set
  private peerValues: Map<string, number> = new Map();
  //set of discovered peers
  private addressBook: Map<string, Multiaddr[]> = new Map();
  //connection collection
  private connections: Map<string, MockConnection[]> = new Map();
  //protocol callback collection
  private protocolHandlers: Map<string, (input: { connection: Connection; stream: Stream }) => void> = new Map();
  //local discv5 object
  private discv5: MockDiscv5;
  //node configuration object
  private config: MockLibp2pConfig;
  //local multiAddr string collection
  announce: Set<string> = new Set();
  //start state variable
  private isStart = false;
  //stop state variable
  private isAbort: boolean = false;
  //maximum connection check timer
  private checkMaxLimitTimer: NodeJS.Timer | undefined;
  //Initialize each property
  constructor(config: MockLibp2pConfig, discv5: MockDiscv5, networkService: NetworkService) {
    super();
    this.config = config;
    this.discv5 = discv5;
    this.networkService = networkService;
    this.setAnnounce([new Multiaddr(`/ip4/${config.enr.ip}/tcp/${config.enr.tcp ?? defaultTcpPort}`)]);
    networkService.registerPeer(this);
  }

  //Get local peerId
  get peerId(): PeerId {
    return this.config.peerId;
  }

  //Get the maximum number of connections
  get maxConnections(): number {
    return this.config.maxPeers ?? 50;
  }

  //Get the current number of connections
  get connectionSize(): number {
    return Array.from(this.connections.values()).reduce((accumulator, value) => accumulator + value.length, 0);
  }

  //Get Discovered nodes
  get peers(): string[] {
    return Array.from(this.addressBook.keys());
  }

  //delete peer
  removeAddress(peerId: PeerId): boolean {
    this.addressBook.delete(peerId.toB58String());
    this.peerValues.delete(peerId.toB58String());
    return true;
  }

  //Set the callback function of the specified protocol (triggered when the specified protocol is passively installed)
  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocolHandlers.set(protocol, callback);
    });
  }

  //Delete the specified protocol callback function
  unhandle(protocols: string | string[]): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocolHandlers.delete(protocol);
    });
  }

  //Add a node
  addAddress(peerId: PeerId, addresses: Multiaddr[]): void {
    if (!PeerId.isPeerId(peerId)) {
      throw new Error('peerId is not a valid PeerId');
    }
    const add = this.addressBook.get(peerId.toB58String()) || [];
    add.forEach((addr) => {
      if (!addresses.find((r) => r.equals(addr))) {
        addresses.push(addr);
      }
    });
    if (addresses.length != add.length) {
      this.addressBook.set(peerId.toB58String(), addresses);
    }
    if (add.length == 0) {
      this.emit('discovery', peerId);
    }
  }

  //Get the multiaddr collection of the specified node
  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.addressBook.get(peerId.toB58String());
  }

  //Connect to the specified node (find the corresponding node through networkService and create a connection)
  async dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    if (peer instanceof Multiaddr) {
      throw new Error('Multiaddr is not supported');
    }
    if (peer instanceof PeerId) {
      peer = peer.toB58String();
    }
    const connections = this.connections.get(peer);
    if (connections) {
      return connections[0];
    } else {
      const targetMultiAddr = this.addressBook.get(peer);
      if (targetMultiAddr) {
        const conn = this.networkService.dial(this.peerId.toB58String(), peer, targetMultiAddr);
        this.handleConnection(conn);
        return conn;
      } else {
        throw new Error('peer not found');
      }
    }
  }

  //Delete the specified node (traverse all connections related to the node and call connection.close())
  async hangUp(peerId: string | PeerId): Promise<void> {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    const connections = this.connections.get(peerId);
    if (!connections) {
      return;
    }
    await Promise.all(connections.map((c) => c.close()));
    this.peerValues.delete(peerId);
  }

  //Set node weight
  setPeerValue(peerId: string | PeerId, value: number): void {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    this.peerValues.set(peerId, value);
  }

  //Set the local multiaddr
  setAnnounce(addresses: Multiaddr[]): void {
    this.announce = new Set(addresses.map((addr) => addr.toString()));
  }

  //Get the connection collection of the peerId
  getConnections(peerId: string): Connection[] | undefined {
    return this.connections.get(peerId);
  }

  //start libp2p
  async start(): Promise<void> {
    if (this.isStart) {
      return;
    }
    this.isStart = true;
    this.discv5.on('peer', this.onDiscover);
  }

  //stop libp2p
  async stop(): Promise<void> {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.discv5.off('peer', this.onDiscover);
    this.checkMaxLimitTimer && clearInterval(this.checkMaxLimitTimer);
    const closeTasks: Promise<void>[] = [];
    Array.from(this.connections.values()).map((connections) => {
      for (const c of connections) {
        closeTasks.push(c.close());
      }
    });
    await Promise.all(closeTasks);
    this.connections.clear();
    this.addressBook.clear();
    this.peerValues.clear();
    this.protocolHandlers.clear();
    this.announce.clear();
    this.emit('close');
  }

  //Listen for discv5 discovery peer events
  private onDiscover = (data: { id: PeerId; multiaddrs: Multiaddr[] }) => {
    if (!this.isAbort) this.addAddress(data.id, data.multiaddrs);
  };

  //Handle new connections
  handleConnection(connection: MockConnection): void {
    const peerId = connection.remotePeer.toB58String();
    if (!this.connections.has(peerId)) {
      this.connections.set(peerId, [connection]);
    } else {
      this.connections.get(peerId)!.push(connection);
    }
    this.emit('connect', connection);
    this.checkMaxLimit();
  }

  //Handle connection shutdown
  handleDisConnection(connection: MockConnection): void {
    const peerId = connection.remotePeer.toB58String();
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

  //Process the new stream and trigger the corresponding callback function according to the protocol name (passive creation trigger)
  handleNewStream(protocol: string, connection: MockConnection, stream: Stream): void {
    const callback = this.protocolHandlers.get(protocol);
    if (callback) {
      callback({ connection, stream });
    }
  }

  //Check whether the current connection exceeds the maximum number of connections, and if so, close the connection of the node with the smallest weight
  private checkMaxLimit(): void {
    if (this.connectionSize > this.maxConnections) {
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
