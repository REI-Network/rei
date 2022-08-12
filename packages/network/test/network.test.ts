import levelup from 'levelup';
import PeerId from 'peer-id';
import { expect, assert } from 'chai';
import { createKeypairFromPeerId } from '@gxchain2/discv5';
import { ENR } from '@gxchain2/discv5';
import { NetworkManager } from '../src';
import { SayHi } from './simpleNode';
import { MockLibp2p } from './mock/MockLibp2p';
import { MockDiscv5 } from './mock/MockDiscv5';
import { NetworkService } from './mock/NetworkService';

const memdown = require('memdown');
const udpPort = 4001;
const tcpPort = 6001;
const ip = '192.168.0.1';
describe('NetWork', async () => {
  let bootEnr: string;
  let bootNode: NetworkManager;
  let networkService: NetworkService;

  beforeEach(async () => {
    networkService = new NetworkService();
    bootNode = await createNode(networkService, { ip, udpPort, tcpPort });
    bootEnr = await bootNode.localEnr.encodeTxt();
  });

  afterEach(async () => {
    await networkService.close();
  });

  //----------------------------------------------------------------------------------------------
  it('should be get the correct number of connections', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(
        createNode(networkService, {
          ip,
          tcpPort,
          udpPort,
          bootNodes: [bootEnr]
        })
      );
    }
    const nodes = await Promise.all(pendingNodes);
    const node = nodes[0];
    let callback: (r) => void;
    let timeout: NodeJS.Timeout;
    const p1 = new Promise((resolve) => {
      callback = () => {
        if (node.connectionSize === 3) {
          resolve(true);
        }
      };
      node.on('installed', callback);
    });
    const p2 = new Promise((resolve) => {
      timeout = setTimeout(resolve, 5000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout);
          node.off('installed', callback);
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be get the correct number of peers', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(
        createNode(networkService, {
          ip,
          tcpPort,
          udpPort,
          bootNodes: [bootEnr]
        })
      );
    }
    const nodes = await Promise.all(pendingNodes);
    const node = nodes[0];
    let callback: (r) => void;
    let timeout: NodeJS.Timeout;
    const p1 = new Promise((resolve) => {
      callback = () => {
        if (node.peers.length === 3) {
          resolve(true);
        }
      };
      node.on('installed', callback);
    });
    const p2 = new Promise((resolve) => {
      timeout = setTimeout(resolve, 5000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout);
          node.off('installed', callback);
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be able to remove peer', async () => {
    let node1 = await createNode(networkService, { ip, tcpPort: tcpPort, udpPort: udpPort });
    let node2 = await createNode(networkService, {
      ip,
      tcpPort: tcpPort,
      udpPort: udpPort,
      bootNodes: [node1.localEnr.encodeTxt()]
    });
    let callback1: (r) => void;
    let callback2: (r) => void;
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;

    const p1 = new Promise((resolve) => {
      callback1 = () => {
        if (node2.peers.length === 1) {
          resolve(true);
        }
      };
      node2.on('installed', callback1);
    });
    const p2 = new Promise((resolve) => {
      timeout1 = setTimeout(resolve, 5000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout1);
          node2.off('installed', callback1);
        });
      })
    ).to.equal(true);

    const p3 = new Promise((resolve) => {
      callback1 = () => {
        if (node2.peers.length === 0) {
          resolve(true);
        }
      };
      node2.on('removed', callback1);
    });
    const p4 = new Promise((resolve) => {
      timeout2 = setTimeout(resolve, 5000, false);
    });
    node2.removePeer(node1.peerId);

    expect(
      await new Promise((resolve) => {
        Promise.race([p3, p4]).then((value) => {
          resolve(value);
          clearTimeout(timeout2);
          node2.off('removed', callback2);
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be able to ban peer', async () => {
    let node1 = await createNode(networkService, {
      ip,
      tcpPort: tcpPort,
      udpPort: udpPort,
      bootNodes: [bootEnr]
    });
    let node2 = await createNode(networkService, {
      ip,
      tcpPort: tcpPort,
      udpPort: udpPort,
      bootNodes: [bootEnr]
    });
    let callback1: (r) => void;
    let callback2: (r) => void;
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;

    const p1 = new Promise((resolve) => {
      callback1 = () => {
        if (node2.peers.length === 2) {
          resolve(true);
        }
      };
      node2.on('installed', callback1);
    });
    const p2 = new Promise((resolve) => {
      timeout1 = setTimeout(resolve, 5000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout1);
          node2.off('installed', callback1);
        });
      })
    ).to.equal(true);

    const p3 = new Promise((resolve) => {
      callback1 = () => {
        if (node2.peers.length === 1 && node2.isBanned(node1.peerId)) {
          resolve(true);
        }
      };
      node2.on('removed', callback1);
    });
    const p4 = new Promise((resolve) => {
      timeout2 = setTimeout(resolve, 5000, false);
    });
    node2.ban(node1.peerId);
    expect(
      await new Promise((resolve) => {
        Promise.race([p3, p4]).then((value) => {
          resolve(value);
          clearTimeout(timeout2);
          node2.off('removed', callback2);
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be able to connect static peer', async () => {
    let node = await createNode(networkService, { ip, tcpPort: tcpPort, udpPort: udpPort, outboundThrottleTime: 1000 });
    let staticPeer = await createNode(networkService, { ip, tcpPort: tcpPort, udpPort: udpPort, inboundThrottleTime: 1000 });
    let callback1: (r) => void;
    let callback2: (r) => void;
    let callback3: (r) => void;
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;
    let timeout3: NodeJS.Timeout;
    const p1 = new Promise((resolve) => {
      callback1 = () => {
        if (node.peers.length === 1) {
          resolve(true);
        }
      };
      node.on('installed', callback1);
    });
    const p2 = new Promise((resolve) => {
      timeout1 = setTimeout(resolve, 5000, false);
    });
    node.addPeer(staticPeer.localEnr.encodeTxt());
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout1);
          node.off('installed', callback1);
        });
      })
    ).to.equal(true);

    const p3 = new Promise((resolve) => {
      callback2 = () => {
        if (node.peers.length === 0 && staticPeer.isBanned(node.peerId)) {
          resolve(true);
        }
      };
      node.on('removed', callback2);
    });
    const p4 = new Promise((resolve) => {
      timeout2 = setTimeout(resolve, 5000, false);
    });
    staticPeer.ban(node.peerId, 1000);

    expect(
      await new Promise((resolve) => {
        Promise.race([p3, p4]).then((value) => {
          resolve(value);
          clearTimeout(timeout2);
          node.off('removed', callback2);
        });
      })
    ).to.equal(true);

    const p5 = new Promise((resolve) => {
      callback3 = () => {
        if (node.peers.length === 1 && !staticPeer.isBanned(node.peerId)) {
          resolve(true);
        }
      };
      node.on('installed', callback3);
    });
    const p6 = new Promise((resolve) => {
      timeout3 = setTimeout(resolve, 8000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p5, p6]).then((value) => {
          resolve(value);
          clearTimeout(timeout3);
          node.off('installed', callback3);
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be able to trusted peer', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    let node = await createNode(networkService, {
      ip,
      tcpPort: tcpPort,
      udpPort: udpPort,
      bootNodes: [bootEnr],
      maxPeers: 2
    });
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(
        createNode(networkService, {
          ip,
          tcpPort,
          udpPort,
          bootNodes: [bootEnr]
        })
      );
    }
    await Promise.all(pendingNodes);
    let callback1: (r) => void;
    let callback2: (r) => void;
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;

    const p1 = new Promise((resolve) => {
      callback1 = () => {
        if (node.peers.length === 2) {
          resolve(true);
        }
      };
      node.on('removed', callback1);
    });
    const p2 = new Promise((resolve) => {
      timeout1 = setTimeout(resolve, 5000, false);
    });
    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout1);
          node.off('removed', callback1);
        });
      })
    ).to.equal(true);

    let trusted = await createNode(networkService, { ip, tcpPort: tcpPort, udpPort: udpPort });
    await node.addTrustedPeer(trusted.localEnr.encodeTxt());
    expect(await node.isTrusted(trusted.localEnr.encodeTxt())).to.eq(true);

    const p3 = new Promise((resolve) => {
      callback2 = () => {
        if (node.peers.length === 3) {
          resolve(true);
        }
      };
      node.on('installed', callback2);
    });
    const p4 = new Promise((resolve) => {
      timeout2 = setTimeout(resolve, 5000, false);
    });
    trusted.addPeer(node.localEnr.encodeTxt());
    expect(
      await new Promise((resolve) => {
        Promise.race([p3, p4]).then((value) => {
          resolve(value);
          clearTimeout(timeout2);
          node.off('installed', callback2);
          const peers = node.peers.map((peer) => peer.peerId);
          if (!peers.includes(trusted.peerId)) {
            assert('trusted peer not found');
          }
        });
      })
    ).to.equal(true);
  });

  //----------------------------------------------------------------------------------------------
  it('should be able to abort node', async () => {
    let pendingNodes: Promise<NetworkManager>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingNodes.push(createNode(networkService, { ip, tcpPort, udpPort, bootNodes: [bootEnr] }));
    }
    const nodes = await Promise.all(pendingNodes);
    let callback1: (r) => void;
    let callback2: (r) => void;
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;
    const node1 = nodes[0];
    const node2 = nodes[1];
    const p1 = new Promise((resolve) => {
      callback1 = () => {
        if (node2.peers.length === 3) {
          resolve(true);
        }
      };
      node2.on('installed', callback1);
    });
    const p2 = new Promise((resolve) => {
      timeout1 = setTimeout(resolve, 5000, false);
    });

    expect(
      await new Promise((resolve) => {
        Promise.race([p1, p2]).then((value) => {
          resolve(value);
          clearTimeout(timeout1);
          node2.off('installed', callback1);
        });
      })
    ).to.equal(true);

    const p3 = new Promise((resolve) => {
      callback2 = () => {
        if (node2.peers.length === 2) {
          resolve(true);
        }
      };
      node2.on('removed', callback2);
    });
    const p4 = new Promise((resolve) => {
      timeout2 = setTimeout(resolve, 8000, false);
    });
    node1.abort();

    expect(
      await new Promise((resolve) => {
        Promise.race([p3, p4]).then((value) => {
          resolve(value);
          clearTimeout(timeout2);
          node2.off('removed', callback2);
        });
      })
    ).to.equal(true);
  });
});

type NodeOpts = { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[]; maxPeers?: number; outboundThrottleTime?: number; inboundThrottleTime?: number };

async function createNode(networkService: NetworkService, opts: NodeOpts) {
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
    inboundThrottleTime: opts.inboundThrottleTime,
    libp2pOptions: {
      bootnodes: opts.bootNodes ? opts.bootNodes : [],
      tcpPort: opts.tcpPort,
      udpPort: opts.udpPort
    }
  });
  await node.init();
  await node.start();
  networkService.addNetworkManager(node);
  return node;
}

function createEnrAndKeypair(peerId: PeerId, opts: { ip: string; tcpPort: number; udpPort: number }) {
  const keypair = createKeypairFromPeerId(peerId);
  let enr = ENR.createV4(keypair.publicKey);
  enr.ip = opts.ip;
  enr.tcp = opts.tcpPort;
  enr.udp = opts.udpPort;
  enr.encode(keypair.privateKey);
  return { enr, keypair };
}
