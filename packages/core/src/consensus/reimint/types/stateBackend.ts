import { Address, BN, BNLike } from 'ethereumjs-util';
import { Block, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { SendMessageOptions } from '../../../protocols/consensus';
import { StateMachineMsg } from '../stateMessages';
import { Message } from '../messages';
import { Evidence } from '../evpool';
import { Vote } from '../vote';

export interface ISigner {
  address(): Address;
  sign(msg: Buffer): Buffer;
  signBls(msg: Buffer): Buffer;
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
  preProcessBlock(block: Block): Promise<IProcessBlockResult | undefined>;
  commitBlock(block: Block, result: IProcessBlockResult): Promise<void>;
  getVoteVersion(num: BNLike): number;
}

export interface IStateMachineP2PBackend {
  broadcastVote(vote: Vote): void;
  broadcastMessage(msg: Message, options: SendMessageOptions): void;
}

export interface IDebug {
  precommitForEmptyWhenFirstRound?: boolean;
  conflictVotes?: boolean;
}
