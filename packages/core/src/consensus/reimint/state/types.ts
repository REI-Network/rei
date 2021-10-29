import { Address, BN } from 'ethereumjs-util';
import { Block, HeaderData, TypedTransaction, BlockOptions } from '@gxchain2/structure';
import { Evidence, Message, Proposal, VoteSet } from '../types';

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
  generateBlockAndProposal(data?: HeaderData, transactions?: TypedTransaction[], options?: any /*TODO*/): { block: Block; proposal?: Proposal };
  generateFinalizedBlock(data: HeaderData, transactions: TypedTransaction[], evidence: Evidence[], proposal: Proposal, votes: VoteSet, options?: BlockOptions);
  processBlock(block: Block, options: any /*TODO*/): Promise<boolean>;
}
