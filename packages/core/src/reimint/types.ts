import type { Address, BN, BNLike } from 'ethereumjs-util';
import type { Block, Receipt } from '@rei-network/structure';
import type { Common } from '@rei-network/common';
import type { SendMessageOptions } from '../protocols/consensus';
import type { ConsensusMessage } from '../protocols/consensus/messages';
import type { StateMachineMsg } from './messages/index';
import type { Evidence } from './evpool';
import type { Vote } from './vote';

export interface ISigner {
  address(): Address;
  ecdsaUnlocked(): boolean;
  ecdsaSign(msg: Buffer): Buffer;
  blsPublicKey(): Buffer | undefined;
  blsSign(msg: Buffer): Buffer;
}

export interface IConfig {
  proposeDuration(round: number): number;
  prevoteDuration(round: number): number;
  precommitDutaion(round: number): number;
}

export interface IEvidencePool {
  addEvidence(ev: Evidence): Promise<boolean>;
  pickEvidence(height: BN, count: number): Promise<Evidence[]>;
}

export interface IWAL {
  open(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
  write(message: StateMachineMsg, flush?: boolean): Promise<boolean>;
  searchForLatestEndHeight(): Promise<{ reader: IWALReader; height: BN } | undefined>;
  newReader(): IWALReader;
}

export interface IWALReader {
  close(): Promise<void>;
  read(): Promise<StateMachineMsg | undefined>;
}

export interface IProcessBlockResult {
  receipts: Receipt[];
}

export interface IStateMachineBackend {
  getCommon(num: BNLike): Common;
  preprocessBlock(block: Block): Promise<IProcessBlockResult | undefined>;
  commitBlock(block: Block, result: IProcessBlockResult): Promise<void>;
}

export interface IStateMachineP2PBackend {
  broadcastVote(vote: Vote): void;
  broadcastMessage(msg: ConsensusMessage, options: SendMessageOptions): void;
}

export interface IDebug {
  precommitForEmptyWhenFirstRound?: boolean;
  conflictVotes?: boolean;
}
