import { Block, Receipt } from '@rei-network/structure';

export type Message = {
  id: number;
  method?: string;
  data?: any;
  err?: string;
};

export type Handler = (data: any) => any;

export type RLPFinalizeOpts = {
  block: Buffer;
  stateRoot: Buffer;
  receipts: Buffer[];

  round?: number;
  evidence?: Buffer[];
  parentStateRoot?: Buffer;
};

export type RLPFinalizeResult = {
  finalizedStateRoot: Buffer;
};

export type RLPProcessBlockOpts = {
  block: Buffer;
  skipConsensusValidation?: boolean;
  skipConsensusVerify?: boolean;
};

export type RLPProcessBlockResult = {
  receipts: Buffer[];
};

export type RLPProcessTxOpts = {
  block: Buffer;
  root: Buffer;
  tx: Buffer;
  blockGasUsed?: Buffer;
};

export type RLPProcessTxResult = {
  receipt: Buffer;
  gasUsed: Buffer;
  bloom: Buffer;
};

export type CommitBlockOpts = {
  block: Block;
  receipts: Receipt[];
};

export type RLPCommitBlockOpts = {
  block: Buffer;
  receipts: Buffer[];
};

export type CommitBlockResult = {
  reorged: boolean;
};

export type RLPCommitBlockResult = {
  reorged: boolean;
};
