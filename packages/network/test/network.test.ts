import levelup from 'levelup';
import PeerId from 'peer-id';
import { expect, assert } from 'chai';
import { createKeypairFromPeerId } from '@gxchain2/discv5';
import { ENR } from '@gxchain2/discv5';
import { NetworkManager } from '../src';
import { SayHi } from './mock/MockProtocol';
import { MockLibp2p } from './mock/MockLibp2p';
import { MockDiscv5 } from './mock/MockDiscv5';
import { NetworkService } from './mock/NetworkService';

const memdown = require('memdown');

describe('NetWork', async () => {
  let bootEnr: string;
  let bootNode: NetworkManager;
  let networkService: NetworkService;
  let networkManagers: NetworkManager[] = [];

  // create a test node
  const createNode = async (opts: NodeOpts = {}) => {
    const db = levelup(memdown());
    const peerId = await PeerId.create({ keyType: 'secp256k1' });
    const { enr, keypair } = createEnrAndKeypair(peerId, opts);
    const discv5 = new MockDiscv5({ keypair, enr, bootNodes: opts.bootNodes }, networkService);
    const libp2p = new MockLibp2p({ peerId, enr, maxPeers: opts.maxPeers ?? 50 }, discv5, networkService);
    const node = new NetworkManager({
      peerId,
      protocols: [new SayHi()],
      nodedb: db,
      nat: opts.ip,
      discv5,
      libp2p,
      outboundThrottleTime: opts.outboundThrottleTime,
      inboundThrottleTime: opts.inboundThrottleTime
    });
    await node.init();
    await node.start();
    networkManagers.push(node);
    return node;
  };

  beforeEach(async () => {
    networkService = new NetworkService();
    bootNode = await createNode();
    bootEnr = await bootNode.localEnr.encodeTxt();
  });

  afterEach(async () => {
    await Promise.all(networkManagers.map((n) => n.abort()));
  });

  // test whether the number of connections is normal
  it('should be get the correct number of connections', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(
        createNode({
          bootNodes: [bootEnr]
        })
      );
    }
    const nodes = await Promise.all(pendingNodes);
    const node = nodes[0];
    expect(
      await check(node, 'installed', () => {
        return node.connectionSize === 3;
      })
    ).to.equal(true);
  });

  // test whether the number of nodes is normal
  it('should be get the correct number of peers', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(
        createNode({
          bootNodes: [bootEnr]
        })
      );
    }
    const nodes = await Promise.all(pendingNodes);
    const node = nodes[0];
    expect(
      await check(node, 'installed', () => {
        return node.peers.length === 3;
      })
    ).to.equal(true);
  });

  // test whether deleting a node is normal
  it('should be able to remove peer', async () => {
    let node1 = await createNode();
    let node2 = await createNode({
      bootNodes: [node1.localEnr.encodeTxt()]
    });

    expect(
      await check(node2, 'installed', () => {
        return node2.peers.length === 1;
      })
    ).to.equal(true);

    node2.removePeer(node1.peerId);

    expect(
      await check(node2, 'removed', () => {
        return node2.peers.length === 0;
      })
    ).to.equal(true);
  });

  // test whether the ban node is normal
  it('should be able to ban peer', async () => {
    let node1 = await createNode({
      bootNodes: [bootEnr]
    });
    let node2 = await createNode({
      bootNodes: [bootEnr]
    });

    expect(
      await check(node2, 'installed', () => {
        return node2.peers.length === 2;
      })
    ).to.equal(true);

    node2.ban(node1.peerId);

    expect(
      await check(node2, 'removed', () => {
        return node2.peers.length === 1 && node2.isBanned(node1.peerId);
      })
    ).to.equal(true);
  });

  // test whether adding a static node is normal
  it('should be able to connect static peer', async () => {
    let node = await createNode({ outboundThrottleTime: 1000 });
    let staticPeer = await createNode({ inboundThrottleTime: 1000 });

    node.addPeer(staticPeer.localEnr.encodeTxt());
    expect(
      await check(node, 'installed', () => {
        return node.peers.length === 1;
      })
    ).to.equal(true);

    staticPeer.ban(node.peerId, 1000);
    expect(
      await check(node, 'removed', () => {
        return node.peers.length === 0 && staticPeer.isBanned(node.peerId);
      })
    ).to.equal(true);

    expect(
      await check(node, 'installed', () => {
        return node.peers.length === 1 && !staticPeer.isBanned(node.peerId);
      })
    ).to.equal(true);
  });

  // test whether adding a trust node is normal
  it('should be able to trusted peer', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    let node = await createNode({
      bootNodes: [bootEnr],
      maxPeers: 2
    });
    for (let i = 0; i < 5; i++) {
      pendingNodes.push(
        createNode({
          bootNodes: [bootEnr]
        })
      );
    }
    await Promise.all(pendingNodes);
    expect(
      await check(node, 'removed', () => {
        return node.connectionSize === 2;
      })
    ).to.equal(true);

    let trusted = await createNode();
    await node.addTrustedPeer(trusted.localEnr.encodeTxt());
    expect(await node.isTrusted(trusted.localEnr.encodeTxt())).to.eq(true);

    trusted.addPeer(node.localEnr.encodeTxt());
    expect(
      await check(node, 'installed', () => {
        const peers = node.peers.map((peer) => peer.peerId);
        return node.connectionSize === 2 && peers.includes(trusted.peerId);
      })
    ).to.equal(true);
  });

  // test whether the node abort is normal
  it('should be able to abort node', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(createNode({ bootNodes: [bootEnr] }));
    }
    const nodes = await Promise.all(pendingNodes);
    const node1 = nodes[0];
    const node2 = nodes[1];
    expect(
      await check(node2, 'installed', () => {
        return node2.peers.length === 3;
      })
    ).to.equal(true);

    node1.abort();
    expect(
      await check(node2, 'removed', () => {
        return node2.peers.length === 2;
      })
    ).to.equal(true);
  });
});

const udpPort = 4001;
const tcpPort = 6001;
const ip = '192.168.0.1';

type NodeOpts = { ip?: string; tcpPort?: number; udpPort?: number; bootNodes?: string[]; maxPeers?: number; outboundThrottleTime?: number; inboundThrottleTime?: number };

// create en and key pair
function createEnrAndKeypair(peerId: PeerId, opts: { ip?: string; tcpPort?: number; udpPort?: number }) {
  const keypair = createKeypairFromPeerId(peerId);
  let enr = ENR.createV4(keypair.publicKey);
  enr.ip = opts.ip ?? ip;
  enr.tcp = opts.tcpPort ?? tcpPort;
  enr.udp = opts.udpPort ?? udpPort;
  enr.encode(keypair.privateKey);
  return { enr, keypair };
}

async function check(node: NetworkManager, event: any, condition: () => boolean): Promise<boolean> {
  let timeout: NodeJS.Timeout;
  let callback: () => void;
  let pending: ((value: boolean) => void)[] = [];
  const p1 = new Promise<boolean>((resolve) => {
    callback = () => {
      if (condition()) {
        resolve(true);
      }
    };
    node.on(event, callback);
    pending.push(resolve);
  });
  const p2 = new Promise<boolean>((resolve) => {
    timeout = setTimeout(resolve, 5000, false);
    pending.push(resolve);
  });
  return Promise.race([p1, p2]).finally(() => {
    clearTimeout(timeout);
    node.off(event, callback);
    pending.map((p) => p(true));
  });
}
