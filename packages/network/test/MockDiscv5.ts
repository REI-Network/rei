import EventEmitter from 'events';
import PeerId from 'peer-id';
import { v4, v6 } from 'is-ip';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { IDiscv5 } from '../src/types';

class WholeNetwork {
  nodes: Map<string, MoacDiscv5> = new Map();
  constructor() {}

  register(enr: ENR, discv5: MoacDiscv5) {
    this.nodes.set(enr.nodeId, discv5);
  }

  lookUp(caller: MoacDiscv5, nodeId: string, recursion: boolean = true) {
    const node = this.nodes.get(nodeId);
    if (node) {
      const callerId = caller.localEnr.nodeId;
      const nodes = node.knownNodes.values();
      if (!recursion) {
        caller.handleEnr(node.localEnr);
      }
      for (const node of nodes) {
        if (node.nodeId !== callerId) {
          caller.handleEnr(node);
        }
      }
      if (recursion) {
        this.lookUp(node, caller.localEnr.nodeId, false);
      }
    }
  }
}

class MoacDiscv5 extends EventEmitter implements IDiscv5 {
  private enr: ENR;
  knownNodes: Map<string, ENR> = new Map();
  wholeNetwork: WholeNetwork;
  startTimer: NodeJS.Timeout | undefined;

  constructor(enr: ENR, bootNode: ENR[], w: WholeNetwork) {
    super();
    this.enr = enr;
    this.wholeNetwork = w;
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
    this.startTimer = setInterval(() => {
      for (const id of this.knownNodes.keys()) {
        this.wholeNetwork.lookUp(this, id);
      }
    }, 2000);
  }

  stop() {
    this.startTimer && clearInterval(this.startTimer);
  }

  size() {
    return this.knownNodes.size;
  }

  async handleEnr(enr: ENR) {
    if (!this.knownNodes.has(enr.nodeId)) {
      this.knownNodes.set(enr.nodeId, enr);
      this.emit('peer', {
        id: (await enr.peerId()).toB58String(),
        multiaddrs: [enr.getLocationMultiaddr('tcp')]
      });
    }
  }
}

async function createNode(w: WholeNetwork, bootNode: ENR[], options: { nat?: string; tcpPort?: number; udpPort?: number }) {
  const keypair = createKeypairFromPeerId(await PeerId.create({ keyType: 'secp256k1' }));
  let enr = ENR.createV4(keypair.publicKey);
  enr.encodeTxt(keypair.privateKey);
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
  const discv5 = new MoacDiscv5(enr, bootNode, w);
  discv5.start();
  return discv5;
}

async function main() {
  const w = new WholeNetwork();
  let tcpPort = 4191;
  let udpPort = 9810;
  let nat = '192.168.0.4';
  let list: Promise<MoacDiscv5>[] = [];
  const bootNode = await createNode(w, [], { nat: '192.168.0.4', tcpPort, udpPort });
  for (let i = 0; i < 10; i++) {
    tcpPort += 1;
    udpPort += 1;
    const node = createNode(w, [bootNode.localEnr], { nat, tcpPort, udpPort });
    list.push(node);
  }
  const nodes = [bootNode, ...(await Promise.all(list))];
  setInterval(() => {
    for (const node of nodes) {
      console.log(`time:${Date.now()}, nodeId ${node.localEnr.nodeId} `, node.size());
    }
  }, 4000);

  setInterval(async () => {
    tcpPort += 1;
    udpPort += 1;
    const newOne = await createNode(w, [bootNode.localEnr], { nat, tcpPort, udpPort });
    for (const node of nodes) {
      node.addEnr(newOne.localEnr);
    }
    nodes.push(newOne);
  }, 8000);
}

main();
