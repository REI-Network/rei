import Multiaddr from 'multiaddr';
import PeerId from 'peer-id';
import { Message } from '../messages';
import { Connection } from '../types';
import { MockConnection, MockStream } from './MockLibp2p';
export class ConnectionMessage extends Message {
  readonly connection: MockConnection;
  readonly isConnect: boolean;
  constructor(connection: MockConnection, isConnect: boolean) {
    super();
    this.connection = connection;
    this.isConnect = isConnect;
  }
}

export class StreamMessage extends Message {
  readonly connection: MockConnection;
  readonly protocol: string;
  readonly stream: MockStream;
  constructor(protocol: string, connection: MockConnection, stream: MockStream) {
    super();
    this.connection = connection;
    this.protocol = protocol;
    this.stream = stream;
  }
}

export class DiscoverMessage extends Message {
  readonly peerId: PeerId;
  readonly multiaddr: [Multiaddr];
  constructor(peerId: PeerId, multiaddr: [Multiaddr]) {
    super();
    this.peerId = peerId;
    this.multiaddr = multiaddr;
  }
}

export class CheckMaxLimitMessage extends Message {
  constructor() {
    super();
  }
}

export class DialMessage extends Message {
  readonly peer: string;
  readonly resolve: (connection: Connection) => void;
  constructor(target: string, resolve: (connection) => void) {
    super();
    this.peer = target;
    this.resolve = resolve;
  }
}

export class ConnectedMessage extends Message {
  readonly caller: string;
  readonly target: string;
  readonly resolve: (connection: MockConnection) => void;
  constructor(caller: string, target: string, resolve: (connection: MockConnection) => void) {
    super();
    this.caller = caller;
    this.target = target;
    this.resolve = resolve;
  }
}

export class DisconnectMessage extends Message {
  connection: MockConnection;
  constructor(connection: MockConnection) {
    super();
    this.connection = connection;
  }
}
