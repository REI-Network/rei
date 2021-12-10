import type { Log } from '@gxchain2-ethereumjs/vm/dist/evm/types';

export type Message = {
  id: number;
  method?: string;
  data?: any;
  err?: string;
};

export type Handler = (data: any) => any;

// export type RunBlockArgs = {
//   block: Buffer;
// };

export type RunTxArgs = {
  tx: Buffer;
  number: Buffer;
  root: Buffer;

  block?: Buffer;
  skipNonce?: boolean;
  skipBalance?: boolean;
  skipBlockGasLimitValidation?: boolean;
  reportAccessList?: boolean;
  blockGasUsed?: Buffer;
};

export type RunCallArgs = {
  number: Buffer;
  root: Buffer;

  block?: Buffer;
  gasPrice?: Buffer;
  origin?: Buffer;
  caller?: Buffer;
  gasLimit?: Buffer;
  to?: Buffer;
  value?: Buffer;
  data?: Buffer;
  code?: Buffer;
  depth?: number;
  compiled?: boolean;
  static?: boolean;
  salt?: Buffer;
  selfdestruct?: {
    [k: string]: boolean;
  };
  delegatecall?: boolean;
};

export type RunTxResult = {
  createAddress?: Buffer;
  succeed: boolean;
  gasUsed: Buffer;
  logs?: Log[];
  newRoot: Buffer;
};

export type RunCallResult = {
  createAddress?: Buffer;
  succeed: boolean;
  gasUsed: Buffer;
  logs?: Log[];
  returnValue: Buffer;
};
