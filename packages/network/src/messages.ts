import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { Message as Discv5Message } from '@gxchain2/discv5/lib/message';
import { Stream, Protocol, Connection } from './types';

export abstract class Message {}

export class InstallMessage extends Message {
  readonly connection: Connection;
  readonly protocol: Protocol;
  readonly peerId: string;
  readonly stream?: Stream;
  readonly resolve?: (success: boolean) => void;

  constructor(peerId: string, protocol: Protocol, connection: Connection, stream?: Stream, resolve?: (success: boolean) => void) {
    super();
    this.peerId = peerId;
    this.protocol = protocol;
    this.connection = connection;
    this.stream = stream;
    this.resolve = resolve;
  }
}

export class DiscoveredMessage extends Message {
  readonly peedId: PeerId;

  constructor(peerId: PeerId) {
    super();
    this.peedId = peerId;
  }
}

export class ConnectedMessage extends Message {
  readonly connection: Connection;

  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }
}

export class DisconnectedMessage extends Message {
  readonly connection: Connection;

  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }
}

export class ReceivedMessage extends Message {
  readonly srcId: string;
  readonly src: Multiaddr;
  readonly message: Discv5Message;

  constructor(srcId: string, src: Multiaddr, message: Discv5Message) {
    super();
    this.srcId = srcId;
    this.src = src;
    this.message = message;
  }
}

export class MultiaddrUpdatedMessage extends Message {}

export class RemovePeerMessage extends Message {
  readonly peedId: string;
  readonly resolve?: () => void;

  constructor(peerId: string, resolve?: () => void) {
    super();
    this.peedId = peerId;
    this.resolve = resolve;
  }
}
