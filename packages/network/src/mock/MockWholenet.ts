import { ENR } from '@gxchain2/discv5';
import { MessageType } from '@gxchain2/discv5/lib/message';
import { Channel } from '@rei-network/utils';
import { MockDiscv5 } from './MockDiscv5';
import { MockLibp2p, MockConnection, MockStream } from './MockLibp2p';
import { testChannel } from './testChannel';
import { ConnectedMessage, DisconnectMessage } from './MockMessage';
import { Message } from '../messages';
export class MockWholeNetwork {
  nodes: Map<string, MockDiscv5> = new Map();
  constructor() {}
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
          if (e) caller.handleEnr(e);
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
  try {
    return ENR.decodeTxt(enr.encodeTxt());
  } catch (error) {
    return undefined;
  }
}

export class MockWholeNetwork2 extends MockWholeNetwork {
  peers: Map<string, MockLibp2p> = new Map();
  private readonly channel = new Channel<Message>();
  constructor() {
    super();
    // this.loop();
  }
  async registerPeer(peer: MockLibp2p) {
    this.peers.set(await peer.peerId.toB58String(), peer);
  }
  private push(message: Message): void {
    this.channel.push(message);
  }
  async loop() {
    for await (const message of this.channel) {
      if (message instanceof ConnectedMessage) {
        message.resolve(this._toConnect(message.caller, message.target));
      }
    }
  }

  async toConnect(caller: string, peerId: string, resolve: (connection: MockConnection) => void) {
    // this.push(new ConnectedMessage(caller, peerId, resolve));
    resolve(this._toConnect(caller, peerId));
  }

  async toDisconnect(remote: MockConnection) {
    remote.passiveClose();
  }

  _toConnect(callerId: string, targetId: string) {
    const caller = this.peers.get(callerId);
    const target = this.peers.get(targetId);
    if (caller && target) {
      const callerConnect = new MockConnection(target.peerId, 'outbound', caller);
      const targetConnect = new MockConnection(caller.peerId, 'inbound', target);

      callerConnect.on('close', () => {
        targetConnect.passiveClose();
        // peer.emit('mock:disconnect', targetConnect);
      });
      targetConnect.on('close', () => {
        callerConnect.passiveClose();
        // caller.emit('mock:disconnect', callerConnect);
      });

      callerConnect.on('newStream', (protocol: string, channel: testChannel<{ _bufs: Buffer[] }>, stream: MockStream) => {
        let targetStream = targetConnect.inboundStreams(protocol, channel);
        stream.setSendChannel(targetStream.reciveChannel);
      });
      targetConnect.on('newStream', (protocol: string, channel: testChannel<{ _bufs: Buffer[] }>, stream: MockStream) => {
        let callerStream = callerConnect.inboundStreams(protocol, channel);
        stream.setSendChannel(callerStream.reciveChannel);
      });

      callerConnect.on('closeStream', (protocol: string) => {
        targetConnect.passiveCloseStream(protocol);
      });
      targetConnect.on('closeStream', (protocol: string) => {
        callerConnect.passiveCloseStream(protocol);
      });

      caller.emit('mock:connect', callerConnect);
      target.emit('mock:connect', targetConnect);
      return callerConnect;
    } else {
      throw new Error('peer not found');
    }
  }
}
