import net from 'net';
import levelup from 'levelup';
import PeerId from 'peer-id';
import { Peer, NetworkManager, Protocol, ProtocolHandler, ProtocolStream } from '../src';
import { setLevel } from '@rei-network/utils';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5';
import { NetworkService } from './mock/NetworkService';
import { MockDiscv5 } from './mock/MockDiscv5';
import { MockLibp2p } from './mock/MockLibp2p';
const memdown = require('memdown');

setLevel('silent');
// setLevel('debug');

export class SayHi implements Protocol {
  readonly protocolString: string = ' SayHi';

  async makeHandler(peer: Peer, stream: ProtocolStream) {
    // console.log('makeHandler', peer.peerId);
    return new SayHiHandler(peer, stream);
  }
}

export class SayHiHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly stream: ProtocolStream;
  task: NodeJS.Timeout[] = [];

  constructor(peer: Peer, stream: ProtocolStream) {
    this.peer = peer;
    this.stream = stream;
    this.task.push(
      setTimeout(() => {
        this.stream.send(Buffer.from('hello'));
        // TODO: !!!
        this.task.splice(this.task.length - 1);
      }, 2000)
    );
  }

  async handshake() {
    return true;
  }

  async handle(data: Buffer) {
    const str = data.toString();
    if (str === 'hello') {
      // console.log('received hello message from peer: ', this.peer.peerId);
      this.stream.send(Buffer.from('hi'));
    } else {
      // console.log('received hi message from peer: ', this.peer.peerId);
      this.task.push(
        setTimeout(() => {
          this.stream.send(Buffer.from('hello'));
          this.task.splice(this.task.length - 1);
        }, 5000)
      );
    }
  }

  abort() {
    for (const task of this.task) {
      clearTimeout(task);
    }
    this.task = [];
    // console.log('abort');
  }
}
const networkService = new NetworkService();
export async function autoStartNodes(opts: { ip: string; udpPort: number; tcpPort: number; count?: number; bootEnr?: string; nodesIp?: string }) {
  const nodes: Promise<NetworkManager>[] = [];
  const count = opts.count || opts.count === 0 ? opts.count : 10;
  const ip = opts.ip;
  const nodesIp = opts.nodesIp ? opts.nodesIp : '127.0.0.1';
  let udpPort = opts.udpPort;
  let tcpPort = opts.tcpPort;
  let bootEnr = opts.bootEnr;
  let boot: NetworkManager | undefined;

  if (!bootEnr) {
    let b = await bootNode(ip, udpPort, tcpPort);
    boot = b.bootNode;
    bootEnr = b.bootEnr;
  }
  for (let i = 0; i < count; i++) {
    const ports = await getPorts(udpPort + 1, tcpPort + 1);
    nodes.push(createNode({ ip: nodesIp, tcpPort: ports.tcp, udpPort: ports.udp, bootNodes: [bootEnr] }));
    udpPort = ports.udp;
    tcpPort = ports.tcp;
    console.log('node', i, 'created');
  }
  console.log('auto start nodes success');
  const result = boot ? [boot, ...(await Promise.all(nodes))] : await Promise.all(nodes);
  setInterval(() => {
    for (const node of result) {
      console.log(`peerId ${node.peerId} ==========> connection size:`, node.connectionSize, 'peers:', node.peers.length);
    }
  }, 10000);
  return result;
}

export async function bootNode(ip: string, udpPort: number, tcpPort: number) {
  let { udp, tcp } = await getPorts(udpPort, tcpPort);
  const bootNode = await createNode({ ip, tcpPort: tcp, udpPort: udp });
  const bootEnr = await bootNode.localEnr.encodeTxt();
  return { bootNode, bootEnr };
}

export async function startNode(ip, tcpPort, udpPort, enr) {
  await createNode({ ip, tcpPort, udpPort, bootNodes: [enr] });
}

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[]; maxPeers?: number }) {
  const db = levelup(memdown());
  const peerId = await PeerId.create({ keyType: 'secp256k1' });
  const { enr, keypair } = createEnrAndKeypair(peerId, opts);
  const discv5 = new MockDiscv5({ keypair, enr, bootNodes: opts.bootNodes }, networkService);
  const libp2p = new MockLibp2p({ peerId, enr, maxPeers: opts.maxPeers ?? 50 }, discv5, networkService);
  enr.encode(keypair.privateKey);
  const node = new NetworkManager({
    peerId,
    protocols: [new SayHi()],
    nodedb: db,
    nat: opts.ip,
    discv5,
    libp2p,
    libp2pOptions: {
      bootnodes: opts.bootNodes ? opts.bootNodes : [],
      tcpPort: opts.tcpPort,
      udpPort: opts.udpPort
    }
  });
  await node.init();
  node.on('installed', (peer) => {
    console.log('node:', node.peerId, 'installed:', peer.peerId);
  });
  node.on('uninstalled', (peer) => {
    console.log('node:', node.peerId, 'uninstalled:', peer.peerId);
  });
  node.on('removed', (peer) => {
    console.log('node:', node.peerId, 'removed:', peer.peerId);
  });
  await node.start();
  console.log('create node success', 'peerId:', node.peerId, 'ip:', opts.ip, 'tcpPort:', opts.tcpPort, 'udpPort:', opts.udpPort);
  return node;
}

async function getPorts(udp: number, tcp: number) {
  while (await portIsOccupied(udp)) {
    if (udp > 65535) {
      throw new Error('udp port is out of limits');
    }
    udp++;
  }

  while (await portIsOccupied(tcp)) {
    if (tcp > 65535) {
      throw new Error('tcp port is out of limits');
    }
    tcp++;
  }
  return { udp, tcp };
}

function portIsOccupied(port: number) {
  return new Promise((resolve) => {
    var server = net.createServer().listen(port);
    server.on('listening', function () {
      server.close();
      console.log('The port【' + port + '】 is available.');
      resolve(false);
    });
    server.on('error', function (err) {
      if ((err as any).code === 'EADDRINUSE') {
        console.log('The port【' + port + '】 is occupied, please change other port.');
        resolve(true);
      }
    });
  });
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
