import levelup from 'levelup';
import PeerId from 'peer-id';
import { NetworkManager } from '../src';
import { SayHi } from './simpleNode';
import { expect, assert } from 'chai';
const memdown = require('memdown');
describe('NetWorkTest', async () => {
  let bootNode: NetworkManager;
  let closedNodes: NetworkManager[] = [];
  let bootEnr: string;
  let udpPort = 4001;
  let tcpPort = 6001;
  let ip = '192.168.0.1';
  beforeEach(async () => {
    bootNode = await createNode({ ip, tcpPort: udpPort, udpPort: tcpPort });
    bootEnr = await bootNode.localEnr.encodeTxt();
  });
  afterEach(async () => {
    await bootNode.abort();
    for (const node of closedNodes) {
      await node.abort();
    }
    bootNode = null as any;
    closedNodes = [];
  });

  it('should be able to connect static peer', async () => {
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    let staticPeer = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    await node.addPeer(staticPeer.localEnr.encodeTxt());
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node.peers.length).to.equal(2);
    closedNodes.push(...[node, staticPeer]);
  });

  it('should be able to trusted peer', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr], maxPeers: 2 });
    for (let i = 0; i < 5; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    let trusted = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    node.addTrustedPeer(trusted.localEnr.encodeTxt());
    node.addPeer(trusted.localEnr.encodeTxt());
    const peers = node.peers.map((peer) => peer.peerId);
    if (!peers.includes(trusted.peerId)) {
      assert('trusted peer not found');
    }
    closedNodes.push(...[node, trusted]);
  });

  it('should be get the correct number of nodes', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 10; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
    expect(node.peers.length).to.equal(11);
    closedNodes.push(node);
  });

  it('should be get the correct number of connections', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 10; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 3500);
    });
    expect(node.connectionSize).to.equal(11);
    closedNodes.push(node);
  });

  it('should be able to abort node', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 10; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
    await node.abort();
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(bootNode.connectionSize).to.equal(10);
    closedNodes.push(node);
  });
});

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[]; maxPeers?: number }) {
  const db = levelup(memdown());
  const node = new NetworkManager({
    peerId: await PeerId.create({ keyType: 'secp256k1' }),
    protocols: [new SayHi()],
    nodedb: db,
    nat: opts.ip,
    libp2pOptions: {
      bootnodes: opts.bootNodes ? opts.bootNodes : [],
      tcpPort: opts.tcpPort,
      udpPort: opts.udpPort,
      maxPeers: opts.maxPeers ? opts.maxPeers : 50
    }
  });
  await node.init();
  await node.start();
  return node;
}
