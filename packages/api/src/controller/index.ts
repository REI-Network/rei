import { DebugController } from './debug';
import { ETHController } from './eth';
import { NetController } from './net';
import { TxPoolController } from './txpool';
import { Web3Controller } from './web3';
import { ReiController } from './rei';
import { AdminController } from './admin';

export * from './errors';
export const api = {
  admin: AdminController,
  debug: DebugController,
  eth: ETHController,
  net: NetController,
  txpool: TxPoolController,
  web3: Web3Controller,
  rei: ReiController
};
