import { Address, BN } from 'ethereumjs-util';
import { AccessList as EVMCAccessList } from '../../../binding/dist/evm';

export default class TxContext {
  gasPrice: BN;
  blockGasUsed: BN;
  origin: Address;
  accessList?: EVMCAccessList;
  recentHashes: Buffer[];

  constructor(gasPrice: BN, origin: Address, accessList?: EVMCAccessList, blockGasUsed?: BN, recentHashes?: Buffer[]) {
    this.gasPrice = gasPrice;
    this.origin = origin;
    this.accessList = accessList;
    this.blockGasUsed = blockGasUsed ?? new BN(0);
    this.recentHashes = recentHashes ?? [];
  }
}
