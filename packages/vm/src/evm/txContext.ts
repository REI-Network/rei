import { Address, BN } from 'ethereumjs-util';
import { AccessList as EVMCAccessList } from '@rei-network/binding';

export default class TxContext {
  gasPrice: BN;
  blockGasUsed: BN;
  origin: Address;
  author?: Address;
  accessList?: EVMCAccessList;
  recentHashes: Buffer[];

  constructor(gasPrice: BN, origin: Address, author?: Address, accessList?: EVMCAccessList, blockGasUsed?: BN, recentHashes?: Buffer[]) {
    this.gasPrice = gasPrice;
    this.origin = origin;
    this.author = author;
    this.accessList = accessList;
    this.blockGasUsed = blockGasUsed ?? new BN(0);
    this.recentHashes = recentHashes ?? [];
  }
}
