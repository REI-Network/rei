import EventEmitter from 'events';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { Connection, ILibp2p, Stream } from '../../src/types';
import { MockConnection } from './MockConnection';
import { NetworkService } from './NetworkService';
import { MockDiscv5 } from './MockDiscv5';
import { MockLibp2pConfig, defaultTcpPort } from './MockConfig';

export class MockLibp2p extends EventEmitter implements ILibp2p {
  //networkService对象
  private networkService: NetworkService;
  //节点权重集合
  private peerValues: Map<string, number> = new Map();
  //发现节点集合
  private peers: Map<string, Multiaddr[]> = new Map();
  //连接集合
  private connections: Map<string, MockConnection[]> = new Map();
  //协议回调集合
  private protocolHandlers: Map<string, (input: { connection: Connection; stream: Stream }) => void> = new Map();
  //本地discv5对象
  private discv5: MockDiscv5;
  //节点配置对象
  private config: MockLibp2pConfig;
  //本地multiAddr字符串集合
  announce: Set<string> = new Set();
  //节点打开状态
  private isStart = false;
  //状态变量
  private isAbort: boolean = false;
  //最大连接检查定时器
  private checkMaxLimitTimer: NodeJS.Timer | undefined;
  //初始化各属性
  constructor(config: MockLibp2pConfig, discv5: MockDiscv5, networkService: NetworkService) {
    super();
    this.config = config;
    this.discv5 = discv5;
    this.networkService = networkService;
    this.setAnnounce([new Multiaddr(`/ip4/${config.enr.ip}/tcp/${config.tcpPort ?? defaultTcpPort}`)]);
  }

  //获取本地peerId
  get peerId(): PeerId {
    return this.config.peerId;
  }

  //获取最大连接数
  get maxConnections(): number {
    return this.config.maxPeers ?? 50;
  }

  //获取当前连接数
  get connectionSize(): number {
    return Array.from(this.connections.values()).reduce((accumulator, value) => accumulator + value.length, 0);
  }

  //设置指定协议的回调函数(当指定protocol被动安装时触发)
  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocolHandlers.set(protocol, callback);
    });
  }

  //删除指定协议回调函数
  unhandle(protocols: string | string[]): void {
    if (typeof protocols === 'string') {
      protocols = [protocols];
    }
    protocols.forEach((protocol) => {
      this.protocolHandlers.delete(protocol);
    });
  }

  //添加节点(1.将节点存入peers中 2.若该节点为新发现节点触发'discover'事件通知networkManager)
  addAddress(peerId: PeerId, addresses: Multiaddr[]): void {
    if (!PeerId.isPeerId(peerId)) {
      throw new Error('peerId is not a valid PeerId');
    }
    const add = this.peers.get(peerId.toB58String()) || [];
    add.forEach((addr) => {
      if (!addresses.find((r) => r.equals(addr))) {
        addresses.push(addr);
      }
    });
    if (addresses.length != add.length) {
      this.peers.set(peerId.toB58String(), addresses);
    }
    if (add.length == 0) {
      this.emit('discovery', peerId);
    }
  }

  //获取指定节点的multiaddr集合
  getAddress(peerId: PeerId): Multiaddr[] | undefined {
    return this.peers.get(peerId.toB58String());
  }

  //连接指定节点(通过networkService查找对应节点并创建连接 )
  async dial(peer: string | PeerId | Multiaddr): Promise<Connection> {
    if (peer instanceof Multiaddr) {
      throw new Error('Multiaddr is not supported');
    }
    if (peer instanceof PeerId) {
      peer = peer.toB58String();
    }
    const targetMultiAddr = this.peers.get(peer);
    if (targetMultiAddr) {
      const conn = this.networkService.dial(this.peerId.toB58String(), peer, targetMultiAddr);
      this.handleConnection(conn);
      return conn;
    } else {
      throw new Error('peer not found');
    }
  }

  //删除指定节点(遍历该节点有关的所有连接并调用connection.close())
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

  //设置节点权重
  setPeerValue(peerId: string | PeerId, value: number): void {
    if (peerId instanceof PeerId) {
      peerId = peerId.toB58String();
    }
    this.peerValues.set(peerId, value);
  }

  //设置本地multiaddr
  setAnnounce(addresses: Multiaddr[]): void {
    this.announce = new Set(addresses.map((addr) => addr.toString()));
  }

  //获取指定peerId的connection集合
  getConnections(peerId: string): Connection[] | undefined {
    return this.connections.get(peerId);
  }

  //启动libp2p
  async start(): Promise<void> {
    if (this.isStart) {
      return;
    }
    this.isStart = true;
    this.discv5.on('peer', this.onDiscover);
  }

  //停止libp2p运行(1.设置isAbort为true 2.遍历connections调用connection.close()并删除集合  )
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
    this.peers.clear();
    this.peerValues.clear();
    this.protocolHandlers.clear();
    this.announce.clear();
    this.emit('close');
  }

  //监听discv5发现节点事件
  private onDiscover(data: { id: PeerId; multiaddrs: Multiaddr[] }): void {
    if (!this.isAbort) this.addAddress(data.id, data.multiaddrs);
  }

  //处理新连接(1.将连接存入connections中 2.触发'connect'事件通知networkManager 3.查看连接是否超过了最大连接数)
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

  //处理connection关闭(1.删除connection 2.触发'disconnect'事件通知networkManager)
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

  //处理新stream并根据协议名称触发对应的回调函数(被动创建触发)
  handleNewStream(protocol: string, connection: MockConnection, stream: Stream): void {
    const callback = this.protocolHandlers.get(protocol);
    if (callback) {
      callback({ connection, stream });
    }
  }

  //查看当前连接是否超过最大连接数,若超过则关闭权重最小节点连接
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
