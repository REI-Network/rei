import EventEmitter from 'events';
import PeerId from 'peer-id';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId, IKeypair } from '@gxchain2/discv5/lib/keypair';
import { IDiscv5 } from '../src/types';
import { MessageType } from '@gxchain2/discv5/lib/message';
import { MockWholeNetwork } from './MockWholenet';

export class MockDiscv5 extends EventEmitter implements IDiscv5 {
  private enr: ENR;
  keypair: IKeypair;
  knownNodes = new Map<string, ENR>();
  wholeNetwork: MockWholeNetwork;
  lookUpTimer: NodeJS.Timeout | undefined;
  liveTimer: NodeJS.Timeout | undefined;

  constructor(keypair: IKeypair, enr: ENR, bootNode: ENR[], w: MockWholeNetwork) {
    super();
    this.enr = enr;
    this.keypair = keypair;
    this.wholeNetwork = w;
    this.on('message', ({ srcId, message }) => {
      if (message.type === MessageType.PING) {
        this.wholeNetwork.sendPongMessage(this, srcId);
      } else if (message.type === MessageType.PONG) {
        if (this.localEnr.ip === '127.0.0.1') {
          // TODO
          this.localEnr.ip = '192.168.0.1';
          this.emit('multiaddrUpdated', this.localEnr.getLocationMultiaddr('udp'));
        }
      }
    });
    for (const enr of bootNode) {
      this.knownNodes.set(enr.nodeId, enr);
    }
    w.register(enr, this);
  }

  get localEnr() {
    return this.enr;
  }

  addEnr(enr: string | ENR) {
    try {
      const enrObj = enr instanceof ENR ? enr : ENR.decodeTxt(enr);
      this.handleEnr(enrObj);
    } catch (error) {
      throw Error('Discv5 :: addEnr error!!');
    }
  }

  findEnr(nodeId: string): ENR | undefined {
    return this.knownNodes.get(nodeId);
  }

  start() {
    this.lookUpTimer = setInterval(() => {
      for (const id of this.knownNodes.keys()) {
        this.wholeNetwork.lookUp(this, id);
      }
    }, 2000);
    this.liveTimer = setInterval(() => {
      for (const id of this.knownNodes.keys()) {
        this.wholeNetwork.sendPingMessage(this, id);
      }
    }, 5000);
  }

  stop() {
    this.removeAllListeners();
    this.lookUpTimer && clearInterval(this.lookUpTimer);
    this.liveTimer && clearInterval(this.liveTimer);
  }

  size() {
    return this.knownNodes.size;
  }

  async handleEnr(enr: ENR) {
    if (!this.knownNodes.has(enr.nodeId) || enr.seq > this.knownNodes.get(enr.nodeId)!.seq) {
      this.knownNodes.set(enr.nodeId, enr);
      this.emit('peer', {
        id: await enr.peerId(),
        multiaddrs: [enr.getLocationMultiaddr('tcp')]
      });
    }
  }

  sign() {
    this.localEnr.encode(this.keypair.privateKey);
  }
}

async function createNode(w: MockWholeNetwork, bootNode: ENR[], options: { nat?: string; tcpPort?: number; udpPort?: number }) {
  const keypair = createKeypairFromPeerId(await PeerId.create({ keyType: 'secp256k1' }));
  let enr = ENR.createV4(keypair.publicKey);
  if (options.nat === undefined || v4(options.nat)) {
    enr.ip = options.nat ?? '127.0.0.1';
    enr.tcp = options.tcpPort ?? 4191;
    enr.udp = options.udpPort ?? 9810;
  } else if (options.nat !== undefined && v6(options.nat)) {
    throw new Error('IPv6 is currently not supported');
  } else {
    throw new Error('invalid ip address: ' + options.nat);
  }
  // update enr seq
  enr.seq = BigInt(Date.now());
  enr.encode(keypair.privateKey);
  const discv5 = new MockDiscv5(keypair, enr, bootNode, w);
  discv5.start();
  return discv5;
}

async function main() {
  const w = new MockWholeNetwork();
  let tcpPort = 4191;
  let udpPort = 9810;
  let nat = '192.168.0.4';
  let list: Promise<MockDiscv5>[] = [];
  const bootNode = await createNode(w, [], { nat, tcpPort, udpPort });
  for (let i = 0; i < 10; i++) {
    tcpPort += 1;
    udpPort += 1;
    const node = createNode(w, [bootNode.localEnr], { tcpPort, udpPort });
    list.push(node);
  }
  const nodes = [bootNode, ...(await Promise.all(list))];
  for (const node of nodes) {
    node.on('multiaddrUpdated', () => {
      node.sign();
    });
  }

  setInterval(() => {
    for (const node of nodes) {
      console.log(`time:${Date.now()} ===> nodeId ${node.localEnr.nodeId} `, node.size());
    }
  }, 4000);

  setInterval(async () => {
    tcpPort += 1;
    udpPort += 1;
    const newOne = await createNode(w, [bootNode.localEnr], { tcpPort, udpPort });
    for (const node of nodes) {
      node.addEnr(newOne.localEnr);
    }
    nodes.push(newOne);
  }, 8000);
}
