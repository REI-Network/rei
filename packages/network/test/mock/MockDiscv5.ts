import EventEmitter from 'events';
import { ENR, IKeypair } from '@gxchain2/discv5';
import { IDiscv5 } from '../../src/types';
import { NetworkService } from './NetworkService';
import { MockDiscv5Config, localhost } from './MockConfig';

export class MockDiscv5 extends EventEmitter implements IDiscv5 {
  // networkService instance
  private networkService: NetworkService;
  // discv5 configuration object
  private config: MockDiscv5Config;
  // local node ENR
  private enr: ENR;
  // node public and private key pair
  public keyPair: IKeypair;
  // discovered nodes
  private nodes: Map<string, ENR> = new Map();
  // node discovery timer (searches for nodes within a specified interval)
  private lookupTimer: NodeJS.Timer | undefined;
  // node discovery timer (searches for nodes within a specified interval)
  private keepLiveTimer: NodeJS.Timer | undefined;
  // stop state variable
  private isAbort: boolean = false;
  // start state variable
  private isStart: boolean = false;
  // initialize the properties and add the boot node to the nodes
  constructor(config: MockDiscv5Config, networkService: NetworkService) {
    super();
    this.enr = config.enr;
    this.config = config;
    this.keyPair = config.keypair;
    this.networkService = networkService;
    if (config.bootNodes) {
      for (const enrStr of config.bootNodes) {
        this.addEnr(enrStr);
      }
    }
    this.networkService.registerNode(this);
  }

  // return the local node ENR
  get localEnr(): ENR {
    return this.enr;
  }

  // add the node ENR to nodes (the set of discovered nodes)
  addEnr(enr: string | ENR): void {
    const enrObj = enr instanceof ENR ? enr : ENR.decodeTxt(enr);
    this.handleEnr(enrObj);
  }

  // get node ENR from nodes (collection of discovered nodes)
  findEnr(nodeId: string): ENR | undefined {
    return this.nodes.get(nodeId);
  }

  // start the node
  start(): void {
    if (this.isStart) {
      return;
    }
    this.isStart = true;
    this.lookup();
    this.keepAlive();
  }

  // stop the node
  stop(): void {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.lookupTimer && clearInterval(this.lookupTimer);
    this.keepLiveTimer && clearInterval(this.keepLiveTimer);
    this.nodes.clear();
  }

  // add the new node to the discovery set and trigger the 'peer' event to notify the outside world
  private async handleEnr(enr: ENR) {
    if (enr.nodeId === this.enr.nodeId || enr.ip === localhost) {
      return;
    }
    if (!this.nodes.has(enr.nodeId) || enr.seq > this.nodes.get(enr.nodeId)!.seq) {
      // update node
      this.nodes.set(enr.nodeId, enr);
    }
    const multiaddr = enr.getLocationMultiaddr('tcp');
    if (!multiaddr) {
      return;
    }
    this.emit('peer', {
      id: await enr.peerId(),
      multiaddrs: [multiaddr]
    });
  }

  // search for node services
  private lookup() {
    this.lookupTimer = setInterval(async () => {
      if (this.isAbort) {
        return;
      }
      const localEnr = this.deepCopy(this.localEnr);
      for (const enr of this.nodes.values()) {
        const enrs = await this.networkService.lookup(localEnr, enr.nodeId);
        if (enrs) {
          for (const enr of enrs) {
            this.handleEnr(enr);
          }
        }
      }
    }, this.config.lookupInterval ?? 2000);
  }

  // node keep-alive service
  private keepAlive() {
    this.keepLiveTimer = setInterval(() => {
      if (this.isAbort) {
        return;
      }
      for (const enr of this.nodes.values()) {
        this.networkService.sendPing(this.enr.nodeId, enr.nodeId);
      }
    }, this.config.keepAliveInterval ?? 5000);
  }

  // process the discovery node request
  async handleFindNode(sourceEnr: ENR) {
    await this.handleEnr(sourceEnr);
    return [this.deepCopy(this.enr), ...this.nodes.values()].map((e) => this.deepCopy(e));
  }

  // process the ping message request (call the networkService's sendPong function to send a pong message to the requester)
  handlePing(callerId: string) {
    this.networkService.sendPong(callerId);
  }

  // process pong message (judging whether the ip of the local enr is localhost, if so, update the ip and trigger the 'multiaddr' event to notify the outside world)
  handlePong(ip: string) {
    if (ip && this.enr.ip != ip) {
      this.enr.ip = ip;
      this.emit('multiaddrUpdated', this.localEnr.getLocationMultiaddr('udp'));
    }
  }

  // deep copy enr
  private deepCopy(enr: ENR) {
    return ENR.decodeTxt(enr.encodeTxt());
  }
}
