import Multiaddr from 'multiaddr';
import { MockLibp2p } from './MockLibp2p';
import { MockDiscv5 } from './MockDiscv5';
import { ConnectionManager, MockConnection } from './MockConnection';
import { ENR } from '@gxchain2/discv5';
import { NetworkManager } from '../../src';

type PeerIdStr = string;
type NodeIdStr = string;
const mockIp = '192.168.0.1';

//模拟网络
export class NetworkService {
  //networkManager collection
  private networkManagers: NetworkManager[] = [];
  //peer collection
  private peers: Map<PeerIdStr, MockLibp2p> = new Map();
  //node collection
  private nodes: Map<NodeIdStr, MockDiscv5> = new Map();
  //nodeIp collection
  private nodesIp: Map<string, string> = new Map();
  //connectionManager collection
  private connectionManagers: Map<string, ConnectionManager> = new Map();

  //Add a networkManager
  addNetworkManager(networkManager: NetworkManager) {
    this.networkManagers.push(networkManager);
  }

  //Register node to nodes
  registerNode(discv5: MockDiscv5, ip: string = mockIp) {
    const nodeId = discv5.localEnr.nodeId;
    if (!this.nodes.has(nodeId)) {
      this.nodes.set(nodeId, discv5);
      this.nodesIp.set(nodeId, ip);
    }
  }

  //Register peer to peers
  registerPeer(peer: MockLibp2p) {
    const peerId = peer.peerId.toB58String();
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, peer);
    }
  }

  //Get the latest ENR of the node and all discovered ENRs
  lookup(callerEnr: ENR, target: NodeIdStr) {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      return targetNode.handleFindNode(callerEnr);
    }
  }

  //Send a ping message to the node
  sendPing(caller: NodeIdStr, target: NodeIdStr): void {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      targetNode.handlePing(caller);
    }
  }

  //Send pong message to the node
  sendPong(target: NodeIdStr): void {
    const targetNode = this.nodes.get(target);
    if (targetNode) {
      targetNode.handlePong(this.nodesIp.get(target)!);
    }
  }

  //Connection specified peer
  dial(caller: PeerIdStr, target: PeerIdStr, targetMultiAddrs: Multiaddr[]): MockConnection {
    const targetPeer = this.peers.get(target);
    const callerPeer = this.peers.get(caller)!;
    if (targetPeer) {
      const multiaddrs = targetMultiAddrs.map((multiaddr) => multiaddr.toString());
      for (const multiAddr of multiaddrs) {
        if (targetPeer.announce.has(multiAddr)) {
          const manager = new ConnectionManager(callerPeer, targetPeer, this);
          this.connectionManagers.set(manager.id, manager);
          targetPeer.handleConnection(manager.conn2);
          return manager.conn1;
        }
      }
    }
    throw new Error('target peer not found');
  }

  //Set node ip
  setIp(nodeId: string, ip: string) {
    this.nodesIp.set(nodeId, ip);
  }

  //Get connectionManager
  getConnectionManager(id: string): ConnectionManager | undefined {
    let manager = this.connectionManagers.get(id);
    if (!manager) {
      const data = id.split('-');
      id = data[1] + '-' + data[0];
      manager = this.connectionManagers.get(id);
    }
    return manager;
  }

  //Delete connectionManager
  handleConnectionManagerClose(id) {
    this.connectionManagers.delete(id);
  }

  async close() {
    for (const networkManager of this.networkManagers) {
      await networkManager.abort();
    }
  }
}
