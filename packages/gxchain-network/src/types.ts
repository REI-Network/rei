import { BNLike } from 'ethereumjs-util';
import { Blockchain } from '@gxchain2/blockchain';
import { Database } from '@gxchain2/database';
import { Aborter } from '@gxchain2/utils';
import { TypedTransaction } from '@gxchain2/tx';
import { Common } from '@gxchain2/common';
import { Peer } from './peer';

export interface ISync {
  announce(peer: Peer, height: number): void;
}

export interface ITxPool {
  getTransaction: (hash: Buffer) => TypedTransaction | undefined;
}

export interface ITxFetcher {
  newPooledTransactionHashes(origin: string, hashes: Buffer[]);
}

export interface INode {
  db: Database;
  blockchain: Blockchain;
  sync: ISync;
  status: any;
  txPool: ITxPool;
  txSync: ITxFetcher;
  aborter: Aborter;
  getCommon(num: BNLike): Common;
}
