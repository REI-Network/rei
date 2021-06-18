import { BNLike, BN } from 'ethereumjs-util';
import { Aborter } from '@gxchain2/utils';
import { TypedTransaction, Block } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { Peer } from './peer';

export interface INode {
  db: {
    getBlock(blockId: number | BN | Buffer): Promise<Block>;
  };
  blockchain: {
    latestBlock: Block;
    getBlocks(blockId: Buffer | BN | number, maxBlocks: number, skip: number, reverse: boolean): Promise<Block[]>;
  };
  sync: {
    announce(peer: Peer, height: number, td: BN): void;
  };
  status: any;
  txPool: {
    getTransaction: (hash: Buffer) => TypedTransaction | undefined;
  };
  txSync: {
    newPooledTransactionHashes(origin: string, hashes: Buffer[]);
  };
  aborter: Aborter;
  getCommon(num: BNLike): Common;
}
