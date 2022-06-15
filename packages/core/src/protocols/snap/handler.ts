import { bufferToInt, rlp, BN, intToBuffer, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
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
      await this.applyGetAccountRange(msg);
    } else if (msg instanceof s.GetStorageRange) {
      await this.applyGetStorageRange(msg);
    } else if (msg instanceof s.GetByteCode) {
      await this.applyGetByteCode(msg);
    } else if (msg instanceof s.GetTrieNode) {
      await this.applyGetTrieNode(msg);
    }
  }

  private async applyGetAccountRange(msg: s.GetAccountRange) {
    const [root, start, limit, responseBytes] = msg.raw();
    const accountHash: Buffer[] = [];
    const accountBody: Buffer[] = [];
    const proofs: Buffer[][] = [];
    for await (const { hash, getValue } of this.node.snaptree.accountIterator(root as Buffer, start as Buffer)) {
      if (hash.equals(limit as Buffer)) {
        break;
      }
      accountHash.push(hash);
      const account = getValue();
      accountBody.push(account?.slimSerialize() ?? Buffer.alloc(0));
      proofs.push(await Trie.createProof(new Trie(this.node.db.rawdb, account?.stateRoot), hash));
    }
    this.send(new s.AccountRange(accountHash, accountBody, proofs));
  }

  private async applyGetStorageRange(msg: s.GetStorageRange) {
    const [root, accountHash, startHash, limitHash, responseBytes] = msg.raw();
    const storageHash: Buffer[] = [];
    const storageBody: Buffer[] = [];
    const proofs: Buffer[][] = [];
    // for await (const { hash, getValue } of this.node.snaptree.storageIterator(root as Buffer, accountHash as Buffer, startHash as Buffer)) {
    //   if (hash.equals(limitHash as Buffer)) {
    //     break;
    //   }
    //   storageHash.push(hash);
    //   const storage = getValue();
    //   storageBody.push(storage?.slimSerialize() ?? Buffer.alloc(0));
    //   proofs.push(await Trie.createProof(new Trie(this.node.db.rawdb, storage?.stateRoot), hash));
    // }
  }

  private async applyGetByteCode(msg: s.GetByteCode) {}

  private async applyGetTrieNode(msg: s.GetTrieNode) {}

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
