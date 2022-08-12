import PeerId from 'peer-id';
import { Channel } from '@rei-network/utils';
import { Connection, Stream } from '../../src/types';
import { MockLibp2p } from './MockLibp2p';
import { MockStream } from './MockStream';
import { NetworkService } from './NetworkService';
//protocol name type
type protocolName = string;
//connectionId (auto increment, used for connection deletion in MockLibp2p)
let connectionId = 0;
//connection data type
export type Data = {
  protocol: protocolName;
  data: { _bufs: Buffer[] };
};

//connectionManager(Used to manage connections between nodes)
export class ConnectionManager {
  id: string;
  //connection1
  conn1: MockConnection;
  //connection2
  conn2: MockConnection;
  //networkService instance
  networkService: NetworkService;

  //Initialize two connection objects
  constructor(p1: MockLibp2p, p2: MockLibp2p, netWorkService: NetworkService) {
    this.id = p1.peerId.toB58String() + '-' + p2.peerId.toB58String();
    this.networkService = netWorkService;
    const c1 = new Channel<Data>();
    const c2 = new Channel<Data>();
    this.conn1 = new MockConnection(p2.peerId, p1, c1, c2);
    this.conn2 = new MockConnection(p1.peerId, p2, c2, c1);
    this.conn1.setConnectionManager(this);
    this.conn2.setConnectionManager(this);
  }

  //Passively create a stream (called when actively creating a stream, use a remote connection to passively create a stream to trigger a protocol callback)
  newStream(protocol: protocolName, targetPeedId: string) {
    this.conn1.localPeerId === targetPeedId ? this.conn1.passiveNewStream(protocol) : this.conn2.passiveNewStream(protocol);
  }

  //Close the connection between both parties (called when the connection is actively closed)
  closeConnections() {
    this.conn1.doClose();
    this.conn2.doClose();
    this.networkService.handleConnectionManagerClose(this.id);
  }

  //Close both streams (called when the connection is closed)
  closeStream(protocol: protocolName) {
    this.conn1.doStreamClose(protocol);
    this.conn2.doStreamClose(protocol);
  }
}

export class MockConnection implements Connection {
  //connection id
  id: number;
  //local libp2p
  private libp2p: MockLibp2p;
  //remote peer PeerId
  private remotePeerId: PeerId;
  //collection of streams
  streams: Map<protocolName, MockStream> = new Map();
  //connectionManager instance
  private connectionManager: ConnectionManager | undefined;
  //send data to remote channel
  private sendChannel: Channel<Data>;
  //receive data to local channel
  private receiveChannel: Channel<Data>;
  //receive stream data channel
  private streamsChannel: Channel<Data> = new Channel();
  //node state variable
  private isAbort: boolean = false;
  //Initialize properties and enable monitoring of remote nodes and local streams data
  constructor(remotePeer: PeerId, libp2p: MockLibp2p, sendChannel: Channel<Data>, recevieChannel: Channel<Data>) {
    this.id = connectionId++;
    this.remotePeerId = remotePeer;
    this.libp2p = libp2p;
    this.sendChannel = sendChannel;
    this.receiveChannel = recevieChannel;
    this.handleRemote();
    this.handleLocal();
  }

  //Get the PeerId of the remote peer
  get remotePeer(): PeerId {
    return this.remotePeerId;
  }

  //Create a new stream based on the protocol name
  async newStream(protocols: string | string[]): Promise<{ stream: Stream }> {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    const stream = this._newStream(protocols[0]);
    //notify the remote node to create a stream
    this.connectionManager?.newStream(protocols[0], this.remotePeer.toB58String());
    return { stream };
  }

  //Get all streams
  _getStreams(): Stream[] {
    return Array.from(this.streams.values());
  }

  //Close the connection (close the connection between both parties through the connectionManager)
  async close(): Promise<void> {
    return this.connectionManager?.closeConnections();
  }

  //Set up connection manager
  setConnectionManager(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  //Get the PeerId of the local peer
  get localPeerId(): string {
    return this.libp2p.peerId.toB58String();
  }

  //Passively create a stream(triggered when the remote node actively creates a stream)
  passiveNewStream(protocol: string): void {
    const stream = this._newStream(protocol);
    //notify libp2p to trigger protocol callback
    this.libp2p.handleNewStream(protocol, this, stream);
  }

  //Execute the close connection operation
  doClose(): void {
    if (this.isAbort == true) {
      return;
    }
    this.isAbort = true;
    for (const stream of this.streams.values()) {
      stream.doClose();
    }
    this.streams.clear();
    this.streamsChannel.abort();
    this.connectionManager = undefined;
    this.libp2p.handleDisConnection(this);
  }

  //Perform a delete stream operation (triggered when the connection is closed 1. call stream.close() 2. remove the stream from the streams collection)
  doStreamClose(protocol: string): void {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.doClose();
      this.streams.delete(protocol);
    }
  }

  //Handle stream closing (triggered when the stream is closed when the connection exists, and both streams are closed through the connectionManager)
  handleStreamClose(stream: MockStream): void {
    this.connectionManager?.closeStream(stream.protocol);
  }

  //Create a new stream and store it in the streams collection
  private _newStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (!stream) {
      stream = new MockStream(protocol, this.streamsChannel, this);
      this.streams.set(protocol, stream);
    }
    return stream;
  }

  //Monitor remote data and distribute it to each stream according to the protocol
  private async handleRemote() {
    for await (const Data of this.receiveChannel) {
      if (this.isAbort) {
        return;
      }
      const protocol = Data.protocol;
      const stream = this.streams.get(protocol);
      if (stream) {
        stream.handleData(Data.data);
      }
    }
  }

  //Listen to local streams data and send to remote
  private async handleLocal() {
    for await (const Data of this.streamsChannel) {
      if (this.isAbort) {
        return;
      }
      this.sendChannel.push(Data);
    }
  }
}
