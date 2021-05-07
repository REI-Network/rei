import { DebugController } from './debug';
import { ETHController } from './eth';
import { NetController } from './net';
import { TxPoolController } from './txpool';
import { Web3Controller } from './web3';

export const api = {
  debug: DebugController,
  eth: ETHController,
  net: NetController,
  txpool: TxPoolController,
  web3: Web3Controller
};
