import type BN from 'bn.js';
import { BlockchainInterface } from '@ethereumjs/blockchain';
import { StateManager, StorageDump } from '@ethereumjs/vm/dist/state/interface';

export interface Peer {
  getPeerId(): string;
  pipeWriteStream(stream: any): void;
  pipeReadStream(stream: any): void;
  isWriting(): boolean;
  isReading(): boolean;
  abort(): void;
  addToQueue(msgData: string, waiting?: boolean): void | Promise<void>;
  jsonRPCRequest(method: string, params?: any, timeout?: number): Promise<any>;
  jsonRPCNotify(method: string, params?: any, waiting?: false): void;
  jsonRPCNotify(method: string, params?: any, waiting?: true): Promise<void>;
  jsonRPCNotify(method: string, params?: any, waiting?: boolean): Promise<void> | void;
  jsonRPCReceiveMsg(data: any): void;
}

export interface P2P {
  libp2pNode: any;
  getPeer(id: string): Peer | undefined;
  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void): void;
  getLocalPeerId(): string;
  init(): Promise<void>;
}

export interface Node {
  p2p: P2P;
  db: Database;
  init(): Promise<void>;
}

export interface Common {}

// TODO: add interface...
export interface Database {
  getHeads(): Promise<{
    [key: string]: Buffer;
  }>;
  getHeadHeader(): Promise<Buffer>;
  getHeadBlock(): Promise<Buffer>;
  getBlock(blockId: Buffer | BN | number): Promise</*Block*/ any>;
  getBody(blockHash: Buffer, blockNumber: BN): Promise</*BlockBodyBuffer*/ any>;
  getHeader(blockHash: Buffer, blockNumber: BN): Promise</*BlockHeader*/ any>;
  getTotalDifficulty(blockHash: Buffer, blockNumber: BN): Promise<BN>;
  hashToNumber(blockHash: Buffer): Promise<BN>;
  numberToHash(blockNumber: BN): Promise<Buffer>;
  get(dbOperationTarget: /*DBTarget*/ any, key?: /*DatabaseKey*/ any): Promise<any>;
  batch(ops: /*DBOp*/ any[]): Promise<void>;
}

export { StateManager, StorageDump, BlockchainInterface as Blockchain };
