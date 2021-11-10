import { Address, BN, BNLike } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { ProcessBlockOptions } from '../../../node';
import { SendMessageOptions } from '../../../protocols/consensus';
import { StateMachineMsg } from './stateMessages';
import { Message } from './messages';
import { Evidence } from './evidence';

export interface ISigner {
  address(): Address;
  sign(msg: Buffer): Buffer;
}

export interface IConfig {
  proposeDuration(round: number): number;
  prevoteDuration(round: number): number;
  precommitDutaion(round: number): number;
}

export interface IEvidencePool {
  addEvidence(ev: Evidence): Promise<void>;
  pickEvidence(height: BN, count: number): Promise<Evidence[]>;
}

export interface IWAL {
  open(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
  write(message: StateMachineMsg, flush?: boolean): Promise<boolean>;
  searchForEndHeight(height: BN): Promise<IWALReader | undefined>;
  newReader(): IWALReader;
}

export interface IWALReader {
  close(): Promise<void>;
  read(): Promise<StateMachineMsg | undefined>;
}

export interface IStateMachineBackend {
  getCommon(num: BNLike): Common;
  executeBlock(block: Block, options: ProcessBlockOptions): Promise<boolean>;
}

export interface IStateMachineP2PBackend {
  broadcastMessage(msg: Message, options: SendMessageOptions): void;
}
