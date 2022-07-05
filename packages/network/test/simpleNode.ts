import levelup from 'levelup';
import PeerId from 'peer-id';
import { ENR } from '@gxchain2/discv5';
import { Peer } from '../src/peer';
import { NetworkManager } from '../src/index';
import { Protocol, ProtocolHandler } from '../src/types';
const memdown = require('memdown');

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
      // console.log('makeHandler', peer.peerId);
      return new SayHiHandler(peer);
    };
  }
}

class SayHiHandler implements ProtocolHandler {
  peer: Peer;
  constructor(peer: Peer) {
    this.peer = peer;
    setTimeout(() => {
      this.peer.send('SayHi', Buffer.from('hello'));
    }, 2000);
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
      setTimeout(() => {
        this.peer.send('SayHi', Buffer.from('hello'));
      }, 5000);
    }
  }
  abort() {
    console.log('abort');
  }
}

const defaultUdpPort = 9810;
const defaultTcpPort = 4191;

async function main() {
  const bootNode = await createNode({ tcpPort: defaultTcpPort, udpPort: defaultUdpPort });
  console.log('bootNode peerId ==> ', (await ENR.decodeTxt(bootNode.testEnrStr).peerId()).toB58String());
  for (let i = 1; i <= 2; i++) {
    await createNode({ tcpPort: defaultTcpPort + i, udpPort: defaultUdpPort + i, bootNodes: [bootNode.testEnrStr] });
    // await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
  }
}
async function createNode(opts: { tcpPort: number; udpPort: number; bootNodes?: string[] }) {
  const db = levelup(memdown());
  const node = new NetworkManager({
    peerId: await PeerId.create({ keyType: 'secp256k1' }),
    enable: true,
    protocols: [new SayHi()],
    nodedb: db,
    bootnodes: opts.bootNodes ? opts.bootNodes : [],
    tcpPort: opts.tcpPort,
    udpPort: opts.udpPort,
    nat: '192.168.0.50'
  });
  await node.init();
  await node.start();
  return node;
}

main();
