import { bufferToInt, rlp, BN, intToBuffer, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { mustParseTransction, Transaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@rei-network/structure';
import { logger, Channel, FunctionalBufferSet } from '@rei-network/utils';
import { ProtocolHandler, Peer } from '@rei-network/network';
import { SnapProtocol } from './protocol';
import * as s from '../../consensus/reimint/snapMessages';
import { NetworkProtocol } from '../types';

const maxQueuedSnap = 100;

export class SnapProtocolHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly protocol: SnapProtocol;

  private snapQueue = new Channel<s.SnapMessage>({ max: maxQueuedSnap });

  protected readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(protocol: SnapProtocol, peer: Peer) {
    this.peer = peer;
    this.protocol = protocol;
  }

  get node() {
    return this.protocol.node;
  }

  /**
   *{@link ProtocolHandler.abort}
   */
  abort(): void {}

  /**
   * {@link ProtocolHandler.handle}
   * @param data - Buffer
   */
  async handle(data: Buffer) {
    const msg = s.SnapMessageFactory.fromSerializedMessage(data);
    const code = s.SnapMessageFactory.registry.getCodeByInstance(msg);
    const request = this.waitingRequests.get(code);
    if (msg instanceof s.GetAccountRange) {
      this.applyGetAccountRange(msg);
    } else if (msg instanceof s.AccountRange) {
      this.applyAccountRange(msg);
    } else if (msg instanceof s.GetStorageRange) {
      this.applyGetStorageRange(msg);
    } else if (msg instanceof s.StorageRange) {
      this.applyStorageRange(msg);
    } else if (msg instanceof s.GetByteCode) {
      this.applyGetByteCode(msg);
    } else if (msg instanceof s.ByteCode) {
      this.applyByteCode(msg);
    } else if (msg instanceof s.GetTrieNode) {
      this.applyGetTrieNode(msg);
    } else if (msg instanceof s.TrieNode) {
      this.applyTrieNode(msg);
    }
  }

  private applyGetAccountRange(msg: s.GetAccountRange) {
    this.node;
  }

  private applyAccountRange(msg: s.AccountRange) {}

  private applyGetStorageRange(msg: s.GetStorageRange) {}

  private applyStorageRange(msg: s.StorageRange) {}

  private applyGetByteCode(msg: s.GetByteCode) {}

  private applyByteCode(msg: s.ByteCode) {}

  private applyGetTrieNode(msg: s.GetTrieNode) {}

  private applyTrieNode(msg: s.TrieNode) {}

  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Send message to the remote peer
   * @param msg - Message
   */
  send(msg: s.SnapMessage) {
    if (this.peer.isSupport(NetworkProtocol.REI_SNAP)) {
      this.peer.send(this.protocol.name, s.SnapMessageFactory.serializeMessage(msg));
    }
  }
}
