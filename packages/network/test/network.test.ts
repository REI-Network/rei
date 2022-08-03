import levelup from 'levelup';
import PeerId from 'peer-id';
import { NetworkManager } from '../src';
import { SayHi } from './simpleNode';
import { expect, assert } from 'chai';
const memdown = require('memdown');
describe('NetWork', async () => {
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

  it('should be get the correct number of nodes', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 3; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [node.localEnr.encodeTxt()] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node.peers.length).to.equal(4);
    closedNodes.push(node);
  });

  it('should be get the correct number of connections', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 3; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [node.localEnr.encodeTxt()] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node.connectionSize).to.equal(4);
    closedNodes.push(node);
  });

  it('should be able to remove peer', async () => {
    let node1 = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    let node2 = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [node1.localEnr.encodeTxt()] });
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    expect(node2.peers.length).to.equal(1);
    await node1.removePeer(node2.peerId);
    expect(node2.peers.length).to.equal(0);
    closedNodes.push(...[node1, node2]);
  });

  it('should be able to ban peer', async () => {
    let node1 = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    let node2 = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr, node1.localEnr.encodeTxt()] });
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    expect(node2.peers.length).to.equal(2);
    await node1.ban(node2.peerId);
    expect(node1.isBanned(node2.peerId)).to.equal(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node2.peers.length).to.equal(1);
    closedNodes.push(...[node1, node2]);
  });

  //test reconnect static peer (need to set outboundThrottleTime to 2s)
  // it.only('should be able to connect static peer', async () => {
  //   let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
  //   let staticPeer = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
  //   await node.addPeer(staticPeer.localEnr.encodeTxt());
  //   await new Promise((resolve) => {
  //     setTimeout(resolve, 1000);
  //   });
  //   expect(node.peers.length).to.equal(1);
  //   staticPeer.ban(node.peerId, 2000);
  //   await new Promise((resolve) => {
  //     setTimeout(resolve, 1000);
  //   });
  //   expect(node.peers.length).to.equal(0);
  //   await new Promise((resolve) => {
  //     setTimeout(resolve, 2000);
  //   });
  //   expect(staticPeer.isBanned(node.peerId)).to.equal(false);
  //   expect(node.peers.length).to.equal(1);
  //   closedNodes.push(...[node, staticPeer]);
  // });

  it('should be able to trusted peer', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr], maxConnections: 2 });
    for (let i = 0; i < 2; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [node.localEnr.encodeTxt()] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node.peers.length).to.equal(2);
    let trusted = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    await node.addTrustedPeer(trusted.localEnr.encodeTxt());
    expect(await node.isTrusted(trusted.localEnr.encodeTxt())).to.eq(true);
    await trusted.addPeer(node.localEnr.encodeTxt());
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(node.peers.length).to.equal(2);
    const peers = node.peers.map((peer) => peer.peerId);
    if (!peers.includes(trusted.peerId)) {
      assert('trusted peer not found');
    }
    closedNodes.push(...[node, trusted]);
  });

  it('should be able to abort node', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 3; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    closedNodes.push(...(await Promise.all(nodes)));
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(bootNode.connectionSize).to.equal(4);
    await node.abort();
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(bootNode.connectionSize).to.equal(3);
    closedNodes.push(node);
  });
});

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[]; maxConnections?: number }) {
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
      maxPeers: opts.maxConnections ? opts.maxConnections : 50
    }
  });
  await node.init();
  await node.start();
  return node;
}
