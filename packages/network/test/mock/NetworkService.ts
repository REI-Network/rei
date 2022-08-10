import Multiaddr from 'multiaddr';
import { MockLibp2p } from './MockLibp2p';
import { MockDiscv5 } from './MockDiscv5';
import { ConnectionManager, MockConnection, Data } from './MockConnection';
import { Channel } from '@rei-network/utils';
import { ENR } from '@gxchain2/discv5';

type PeerIdStr = string;
type NodeIdStr = string;
const mockIp = '192.168.0.1';

export class NetworkService {
  //peer集合
  private peers: Map<PeerIdStr, MockLibp2p> = new Map();
  //node集合
  private nodes: Map<NodeIdStr, MockDiscv5> = new Map();
  //nodeIp集合
  private nodesIp: Map<string, string> = new Map();

  //将node注册到nodes中
  registerNode(discv5: MockDiscv5) {
    const nodeId = discv5.localEnr.nodeId;
    if (!this.nodes.has(nodeId)) {
      this.nodes.set(nodeId, discv5);
      this.nodesIp.set(nodeId, mockIp);
    }
  }

  //将peer注册到peers中
  registerPeer(peer: MockLibp2p) {
    const peerId = peer.peerId.toB58String();
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, peer);
    }
  }

  //获取指定node所有已发现ENR(调用目标node的handleLookup)
  lookup(callerEnr: ENR, target: NodeIdStr) {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      return targetNode.handleFindNode(callerEnr);
    }
  }

  //向指定node发送ping message(调用目标node的handlePing)
  sendPing(caller: NodeIdStr, target: NodeIdStr): void {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      targetNode.handlePing(caller);
    }
  }

  //向指定node发送pong message(调用目标node的handlePong)
  sendPong(target: NodeIdStr): void {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      targetNode.handlePong(this.nodesIp.get(target)!);
    }
  }

  //连接指定peer(1.创建新的connection 2.为远端节点创建新的connection 3.两个连接分别设置远程连接 4.调用本地peer和目标peer的handleConnect来通知libp2p连接建立 5.返回本地连接对象)
  dial(caller: PeerIdStr, target: PeerIdStr, targetMultiAddrs: Multiaddr[]): MockConnection {
    const targetPeer = this.peers.get(target);
    const callerPeer = this.peers.get(caller)!;
    if (targetPeer) {
      const multiaddrs = targetMultiAddrs.map((multiaddr) => multiaddr.toString());
      for (const multiAddr of multiaddrs) {
        if (targetPeer.announce.has(multiAddr)) {
          const c1 = new Channel<Data>();
          const c2 = new Channel<Data>();
          const localConn = new MockConnection(targetPeer.peerId, this.peers.get(caller)!, c1, c2);
          const remoteConn = new MockConnection(callerPeer.peerId, targetPeer, c2, c1);
          const manager = new ConnectionManager(localConn, remoteConn);
          localConn.setConnectionManager(manager);
          remoteConn.setConnectionManager(manager);
          return localConn;
        }
      }
    }
    throw new Error('target peer not found');
  }

  //设置node ip
  setIp(nodeId: string, ip: string) {
    this.nodesIp.set(nodeId, ip);
  }
}
