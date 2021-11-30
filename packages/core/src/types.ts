import EventEmitter from 'events';
import { NetworkManagerOptions } from '@gxchain2/network';
import { Receipt, Block } from '@gxchain2/structure';
import { ValidatorSet } from './staking';
import { Evidence } from './consensus/reimint/types';
import { ConsensusEngineOptions } from './consensus/types';

export interface ConsensusEngineConstructorOptions extends Omit<ConsensusEngineOptions, 'node'> {}

export interface NetworkManagerConstructorOptions extends Omit<NetworkManagerOptions, 'protocols' | 'nodedb' | 'datastore'> {}

export interface AccountManagerConstructorOptions {
  /**
   * Keystore full path
   */
  keyStorePath: string;
}

export interface NodeOptions {
  /**
   * Full path of database
   */
  databasePath: string;
  /**
   * Chain name, default is `gxc2-mainnet`
   */
  chain?: string;
  mine: ConsensusEngineConstructorOptions;
  network: NetworkManagerConstructorOptions;
  account: AccountManagerConstructorOptions;
}

export type NodeStatus = {
  networkId: number;
  totalDifficulty: Buffer;
  height: number;
  bestHash: Buffer;
  genesisHash: Buffer;
};

export interface CommitBlockOptions {
  broadcast: boolean;
  block: Block;
  receipts: Receipt[];
  validatorSet?: ValidatorSet;
  evidence?: Evidence[];
}

export abstract class Initializer {
  protected readonly initPromise: Promise<void>;
  protected initResolve?: () => void;

  constructor() {
    this.initPromise = new Promise<void>((resolve) => {
      this.initResolve = resolve;
    });
  }

  protected initOver() {
    if (this.initResolve === undefined) {
      throw new Error('missing initResolve');
    }
    this.initResolve();
    this.initResolve = undefined;
  }
}

export abstract class InitializerWithEventEmitter extends EventEmitter {
  protected readonly initPromise: Promise<void>;
  protected initResolve?: () => void;

  constructor() {
    super();
    this.initPromise = new Promise<void>((resolve) => {
      this.initResolve = resolve;
    });
  }

  protected initOver() {
    if (this.initResolve === undefined) {
      throw new Error('missing initResolve');
    }
    this.initResolve();
    this.initResolve = undefined;
  }
}
