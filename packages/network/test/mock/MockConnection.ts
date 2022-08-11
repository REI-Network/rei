import PeerId from 'peer-id';
import { Channel } from '@rei-network/utils';
import { Connection, Stream } from '../../src/types';
import { MockLibp2p } from './MockLibp2p';
import { MockStream } from './MockStream';
import { NetworkService } from './NetworkService';
//协议名称类型
type protocolName = string;
//connectionId(自增,用于libp2p中connection删除)
let connectionId = 0;
//connection传输数据格式
export type Data = {
  protocol: protocolName;
  data: { _bufs: Buffer[] };
};

//连接管理器
export class ConnectionManager {
  id: string;
  //连接1
  conn1: MockConnection;
  //连接2
  conn2: MockConnection;
  //networkService对象
  networkService: NetworkService;

  //初始化两个连接对象
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

  //被动创建stream(主动创建stream时调用,使用远端连接被动创建stream来触发协议回调)
  newStream(protocol: protocolName, targetPeedId: string) {
    this.conn1.localPeerId === targetPeedId ? this.conn1.passiveNewStream(protocol) : this.conn2.passiveNewStream(protocol);
  }

  //关闭双方连接(主动关闭连接时调用)
  closeConnections() {
    this.conn1.doClose();
    this.conn2.doClose();
    this.networkService.handleConnectionManagerClose(this.id);
  }

  //关闭双方stream(在连接关闭时调用)
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
  //远端节点PeerId
  private remotePeerId: PeerId;
  //streams集合
  streams: Map<protocolName, MockStream> = new Map();
  //连接管理器
  private connectionManager: ConnectionManager | undefined;
  //发送数据至远端通道
  private sendChannel: Channel<Data>;
  //接收数据至本地通道
  private receiveChannel: Channel<Data>;
  //接收stream数据通道
  private streamsChannel: Channel<Data> = new Channel();
  //节点状态变量
  private isAbort: boolean = false;
  //初始化各属性并开启监听远程节点和本地streams数据
  constructor(remotePeer: PeerId, libp2p: MockLibp2p, sendChannel: Channel<Data>, recevieChannel: Channel<Data>) {
    this.id = connectionId++;
    this.remotePeerId = remotePeer;
    this.libp2p = libp2p;
    this.sendChannel = sendChannel;
    this.receiveChannel = recevieChannel;
    this.handleRemote();
    this.handleLocal();
  }

  //获取远端节点的PeerId
  get remotePeer(): PeerId {
    return this.remotePeerId;
  }

  //根据协议名称创建新的stream(1.创建channel 2.使用channel初始化生stream并存入streams集合中 3.通过connectionManager告知对端连接被动创键stream)
  async newStream(protocols: string | string[]): Promise<{ stream: Stream }> {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    const stream = this._newStream(protocols[0]);
    //通知远程节点创建stream
    this.connectionManager?.newStream(protocols[0], this.remotePeer.toB58String());
    return { stream };
  }

  //获取所有stream
  _getStreams(): Stream[] {
    return Array.from(this.streams.values());
  }

  //关闭连接(通过connectionManager关闭双方连接)
  async close(): Promise<void> {
    return this.connectionManager?.closeConnections();
  }

  //设置连接管理器
  setConnectionManager(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  //获取本地节点的PeerId
  get localPeerId(): string {
    return this.libp2p.peerId.toB58String();
  }

  //被动创建stream(1.创建channel 2.使用channel初始化生stream并存入streams集合中 3.触发协议回调)
  passiveNewStream(protocol: string): void {
    const stream = this._newStream(protocol);
    //通知libp2p触发协议回调
    this.libp2p.handleNewStream(protocol, this, stream);
  }

  //执行关闭连接操作(1.将状态变量isAbort设置为true 2.遍历streams调用close 3.通知libp2p删除连接)
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

  //执行删除stream操作(在连接关闭时触发 1.调用stream.close() 2.将stream从streams集合中删除)
  doStreamClose(protocol: string): void {
    let stream = this.streams.get(protocol);
    if (stream) {
      stream.doClose();
      this.streams.delete(protocol);
    }
  }

  //处理stream关闭(在connection存在情况下关闭stream时触发,通过connectionManager关闭双方stream)
  handleStreamClose(stream: MockStream): void {
    this.connectionManager?.closeStream(stream.protocol);
  }

  //创建新stream并存入streams集合
  private _newStream(protocol: string) {
    let stream = this.streams.get(protocol);
    if (!stream) {
      stream = new MockStream(protocol, this.streamsChannel, this);
      this.streams.set(protocol, stream);
    }
    return stream;
  }

  //监听远端数据并根据协议分发给各stream
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

  //监听本地streams数据并发送至远端
  private async handleLocal() {
    for await (const Data of this.streamsChannel) {
      if (this.isAbort) {
        return;
      }
      this.sendChannel.push(Data);
    }
  }
}
