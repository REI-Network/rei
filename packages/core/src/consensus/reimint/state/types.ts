import { Address, BN } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { Evidence, Message } from '../types';

export interface Signer {
  address(): Address;
  sign(msg: Buffer): Buffer;
}

export interface Config {
  proposeDuration(round: number): number;
  prevoteDuration(round: number): number;
  precommitDutaion(round: number): number;
}

export interface EvidencePool {
  addEvidence(ev: Evidence): Promise<void>;
  pickEvidence(height: BN, count: number): Promise<Evidence[]>;
}

export enum RoundStepType {
  NewHeight = 1,
  NewRound,
  Propose,
  Prevote,
  PrevoteWait,
  Precommit,
  PrecommitWait,
  Commit
}

export type StateMachineMessage = MessageInfo | TimeoutInfo;

export type MessageInfo = {
  peerId: string;
  msg: Message;
};

export type TimeoutInfo = {
  duration: number;
  height: BN;
  round: number;
  step: RoundStepType;
};

export interface SendMessageOptions {
  // broadcast the message but exlcude the target peers
  exclude?: string[];
  // send message to target peer
  to?: string;
  // boardcast the message to all peers
  broadcast?: boolean;
}

export interface StateMachineBackend {
  broadcastMessage(msg: Message, options: SendMessageOptions): void;
  executeBlock(block: Block, options: any /*TODO*/): Promise<boolean>;
}
