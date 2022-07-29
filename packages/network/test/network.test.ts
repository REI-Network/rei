import levelup from 'levelup';
import PeerId from 'peer-id';
import { NetworkManager } from '../src';
import { SayHi } from './simpleNode';
import { expect, assert } from 'chai';
const memdown = require('memdown');
describe('NetWork', async () => {
  let bootNode;
  let bootEnr;
  let udpPort = 4001;
  let tcpPort = 6001;
  let ip = '192.168.0.1';
  beforeEach(async () => {
    bootNode = await createNode({ ip, tcpPort: udpPort, udpPort: tcpPort });
    bootEnr = await bootNode.localEnr.encodeTxt();
  });

  it('should be able to connect static peer', async () => {
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    let staticPeer = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    await node.addPeer(staticPeer.localEnr.encodeTxt());
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
    expect(node.peers.length).to.equal(2);
  });

  it('should be able to trusted peer', async () => {
    let nodes: Promise<NetworkManager>[] = [];
    let node = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort, bootNodes: [bootEnr] });
    for (let i = 0; i < 5; i++) {
      nodes.push(createNode({ ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    await Promise.all(nodes);
    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });
    let trusted = await createNode({ ip, tcpPort: tcpPort, udpPort: udpPort });
    node.addTrustedPeer(trusted.localEnr.encodeTxt());
    node.addPeer(trusted.localEnr.encodeTxt());
    const peers = node.peers.map((peer) => peer.peerId);
    if (!peers.includes(trusted.peerId)) {
      assert('trusted peer not found');
    }
  });
});

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[] }) {
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
      maxPeers: 2
    }
  });
  await node.init();
  await node.start();
  return node;
}
