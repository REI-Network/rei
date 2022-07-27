import { ENR } from '@gxchain2/discv5';
import { MessageType } from '@gxchain2/discv5/lib/message';
import { MockDiscv5 } from './MockDiscv5';
import { MockLibp2p, MockConnection, MockStream } from './MockLibp2p';
import { testChannel } from './testChannel';
export class MockWholeNetwork {
  nodes: Map<string, MockDiscv5> = new Map();

  register(enr: ENR, discv5: MockDiscv5) {
    this.nodes.set(enr.nodeId, discv5);
  }

  lookUp(caller: MockDiscv5, targetId: string, recursion: boolean = true) {
    const target = this.nodes.get(targetId);
    if (target) {
      const callerId = caller.localEnr.nodeId;
      const enrs = [target.localEnr, ...target.knownNodes.values()];
      for (const enr of enrs) {
        if (enr.nodeId !== callerId) {
          //deep copy
          const e = deepCopy(enr);
          caller.handleEnr(e);
        }
      }
      if (recursion) {
        this.lookUp(target, caller.localEnr.nodeId, false);
      }
    }
  }

  sendPingMessage(caller: MockDiscv5, targetId: string) {
    const target = this.nodes.get(targetId);
    if (target) {
      target.emit('message', { srcId: caller.localEnr.nodeId, src: caller.localEnr.getLocationMultiaddr('udp'), message: { type: MessageType.PING } });
    }
  }

  sendPongMessage(caller: MockDiscv5, targetId: string) {
    const target = this.nodes.get(targetId);
    if (target) {
      target.emit('message', { srcId: caller.localEnr.nodeId, src: caller.localEnr.getLocationMultiaddr('udp'), message: { type: MessageType.PONG } });
    }
  }
}

function deepCopy(enr: ENR) {
  return ENR.decodeTxt(enr.encodeTxt());
}

export class MockWholeNetwork2 extends MockWholeNetwork {
  peers: Map<string, MockLibp2p> = new Map();
  constructor() {
    super();
  }
  async registerPeer(peer: MockLibp2p) {
    this.peers.set(await peer.peerId.toB58String(), peer);
  }
  toConnect(caller: MockLibp2p, peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      const callerConnect = new MockConnection(peer.peerId, 'outbound', caller);
      const targetConnect = new MockConnection(caller.peerId, 'inbound', peer);
      callerConnect.on('close', () => {
        peer.emit('disconnect', targetConnect);
      });
      targetConnect.on('close', () => {
        caller.emit('disconnect', callerConnect);
      });

      callerConnect.on('newStream', (protocol: string, channel: testChannel<{ _bufs: Buffer[] }>, stream: MockStream) => {
        let targetStream = targetConnect.inboundStreams(protocol, channel);
        stream.setSendChannel(targetStream.reciveChannel);
        stream.on('close', () => {
          console.log('caller stream close');
        });
        targetStream.on('close', () => {
          console.log('target stream close');
        });
      });
      targetConnect.on('newStream', (protocol: string, channel: testChannel<{ _bufs: Buffer[] }>, stream: MockStream) => {
        let callerStream = callerConnect.inboundStreams(protocol, channel);
        stream.setSendChannel(callerStream.reciveChannel);
      });

      callerConnect.on('closeStream', (protocol: string) => {
        targetConnect.closeStream(protocol);
      });
      targetConnect.on('closeStream', (protocol: string) => {
        callerConnect.closeStream(protocol);
      });

      caller.emit('connect', callerConnect);
      peer.emit('connect', targetConnect);
      return callerConnect;
    } else {
      throw new Error('peer not found');
    }
  }
}
