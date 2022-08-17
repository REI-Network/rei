import { Peer, NetworkManager, Protocol, ProtocolHandler, ProtocolStream } from '../../src';
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
