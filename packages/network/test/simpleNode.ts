import fs from 'fs';
import net from 'net';
import levelup from 'levelup';
import PeerId from 'peer-id';
import { Peer } from '../src/peer';
import { NetworkManager } from '../src/index';
import { Protocol, ProtocolHandler } from '../src/types';
const memdown = require('memdown');

const defaultUdpPort = 9810;
const defaultTcpPort = 4191;
const path = './simpleNodeTest.txt';
// const ip = '192.168.0.50';
class SayHi implements Protocol {
  protocolString: string;
  beforeMakeHandler: (peer: Peer) => boolean | Promise<boolean>;
  makeHandler: (peer: Peer) => ProtocolHandler;
  constructor() {
    this.protocolString = 'SayHi';
    this.beforeMakeHandler = () => {
      return true;
    };
    this.makeHandler = (peer: Peer) => {
      console.log('makeHandler', peer.peerId);
      return new SayHiHandler(peer);
    };
  }
}

class SayHiHandler implements ProtocolHandler {
  peer: Peer;
  task: NodeJS.Timeout[] = [];
  constructor(peer: Peer) {
    this.peer = peer;
    this.task.push(
      setTimeout(() => {
        this.peer.send('SayHi', Buffer.from('hello'));
      }, 2000)
    );
  }
  async handshake() {
    return true;
  }
  async handle(data: Buffer) {
    const str = data.toString();
    if (str == 'hello') {
      // console.log('received hello message from peer: ', this.peer.peerId);
      this.peer.send('SayHi', Buffer.from('hi'));
    } else {
      // console.log('received hi message from peer: ', this.peer.peerId);
      this.task.push(
        setTimeout(() => {
          this.peer.send('SayHi', Buffer.from('hello'));
        }, 5000)
      );
    }
  }
  abort() {
    for (const task of this.task) {
      clearTimeout(task);
    }
    console.log('abort');
  }
}

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[] }) {
  const db = levelup(memdown());
  const node = new NetworkManager({
    peerId: await PeerId.create({ keyType: 'secp256k1' }),
    enable: true,
    protocols: [new SayHi()],
    nodedb: db,
    bootnodes: opts.bootNodes ? opts.bootNodes : [],
    tcpPort: opts.tcpPort,
    udpPort: opts.udpPort,
    nat: opts.ip
  });
  await node.init();
  await node.start();
  return node;
}

export async function autoStartNodes(amount: number, ip: string) {
  let nodes: NetworkManager[] = [];
  let { udp, tcp } = await getPorts(defaultUdpPort, defaultTcpPort);
  const bootNode = await createNode({ ip, tcpPort: defaultTcpPort, udpPort: defaultUdpPort });
  nodes.push(bootNode);
  const bootEnr = await bootNode.localEnr.encodeTxt();
  for (let i = 1; i <= amount; i++) {
    const ports = await getPorts(udp + i, tcp + i);
    nodes.push(await createNode({ ip, tcpPort: ports.tcp, udpPort: ports.udp, bootNodes: [bootEnr] }));
    udp = ports.udp;
    tcp = ports.tcp;
  }
  console.log('auto start nodes success');
  return nodes;
}

export async function bootNode(ip) {
  const bootNode = await createNode({ ip, tcpPort: defaultTcpPort, udpPort: defaultUdpPort });
  const bootEnr = await bootNode.localEnr.encodeTxt();
  fs.writeFile(path, bootEnr, (err) => {
    if (err) throw err;
    console.log('boot node enr:', bootEnr);
  });
}

export async function startNode(ip, tcpPort, udpPort, enr) {
  await createNode({ ip, tcpPort, udpPort, bootNodes: [enr] });
}

async function getPorts(udp: number, tcp: number) {
  while ((await portIsOccupied(udp)) || (await portIsOccupied(tcp))) {
    udp++;
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
