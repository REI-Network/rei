import type { BNLike, Account, AccountData, BN, Address } from 'ethereumjs-util';
import type { Block, Transaction } from '@rei-network/structure';
import type { Common } from '@rei-network/common';
import type VM from '@gxchain2-ethereumjs/vm';
import type { WebsocketClient } from './client';

export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export const JSONRPC_VERSION = '2.0';

export interface Request {
  method: string;
  params: any;
  client?: WebsocketClient;

  resolve: (resps: any) => void;
  reject: (reason?: any) => void;
}

export interface Backend {
  readonly chainId: number;

  readonly db: any; // TODO: fix types
  readonly sync: any; // TODO: fix types
  readonly accMngr: any; // TODO: fix types
  readonly txPool: any; // TODO: fix types
  readonly networkMngr: any; // TODO: fix types
  readonly bcMonitor: any; // TODO: fix types
  readonly reimint: any; // TODO: fix types

  getLatestBlock(): Block;
  getPendingBlock(): Block;
  getPendingStateManager(): Promise<StateManager>;
  getStateManager(root: Buffer, num: BNLike | Common): Promise<StateManager>;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
  getCommon(num: BNLike): Common;
  getLatestCommon(): Common;
  getCurrentEngine(): any; // TODO: fix types
  getFilter(): any; // TODO: fix types
  getTracer(): any; // TODO: fix types

  addPendingTxs(txs: Transaction[]): Promise<boolean[]>;
}

export declare type StakeInfoData = {
  total?: BN;
  usage?: BN;
  timestamp?: number;
};
export declare type StakeInfoRaw = [Buffer, Buffer, Buffer];

export declare class StakeInfo {
  total: BN;
  usage: BN;
  timestamp: number;
  static fromStakeInfoData(data?: StakeInfoData): StakeInfo;
  static fromValuesArray(values: Buffer[]): StakeInfo;
  raw(): Buffer[];
  serialize(): Buffer;
  estimateFee(timestamp: number, totalAmount: BN, dailyFee: BN): BN;
  estimateTotalFee(totalAmount: BN, dailyFee: BN): BN;
  estimateUsage(timestamp: number): BN;
  consume(amount: BN, timestamp: number): void;
  deposit(amount: BN): void;
  withdraw(amount: BN): void;
  isEmpty(): boolean;
}

export interface StakingAccountData extends AccountData {
  stakeInfo?: StakeInfoData;
}

export declare class StakingAccount extends Account {
  stakeInfo?: StakeInfo;
  static fromAccountData(accountData: StakingAccountData): StakingAccount;
  static fromRlpSerializedAccount(serialized: Buffer): StakingAccount;
  static fromValuesArray(values: Buffer[]): StakingAccount;
  /**
   * This constructor assigns and validates the values.
   * Use the static factory methods to assist in creating an Account from varying data types.
   */
  constructor(nonce?: BN, balance?: BN, stateRoot?: Buffer, codeHash?: Buffer, stakeInfo?: StakeInfo | undefined);
  /**
   * Returns a Buffer Array of the raw Buffers for the account, in order.
   */
  raw(): Buffer[];
  /**
   * Returns a `Boolean` determining if the account is empty complying to the definition of
   * account emptiness in [EIP-161](https://eips.ethereum.org/EIPS/eip-161):
   * "An account is considered empty when it has no code and zero nonce and zero balance."
   */
  isEmpty(): boolean;
  /**
   * Get stake info of account
   * (Create if it doesn't exist)
   * @returns Stake info
   */
  getStakeInfo(): StakeInfo;
}

/**
 * Interface for getting and setting data from an underlying
 * state trie.
 */
export declare class StateManager {
  copy(): StateManager;
  getAccount(address: Address): Promise<StakingAccount>;
  putAccount(address: Address, account: StakingAccount): Promise<void>;
  deleteAccount(address: Address): Promise<void>;
  touchAccount(address: Address): void;
  putContractCode(address: Address, value: Buffer): Promise<void>;
  getContractCode(address: Address): Promise<Buffer>;
  getContractStorage(address: Address, key: Buffer): Promise<Buffer>;
  getOriginalContractStorage(address: Address, key: Buffer): Promise<Buffer>;
  clearOriginalStorageCache(): void;
  putContractStorage(address: Address, key: Buffer, value: Buffer): Promise<void>;
  clearContractStorage(address: Address): Promise<void>;
  checkpoint(): Promise<void>;
  commit(): Promise<void>;
  revert(): Promise<void>;
  getStateRoot(): Promise<Buffer>;
  setStateRoot(stateRoot: Buffer): Promise<void>;
  dumpStorage(address: Address): Promise<any>; // TODO: types
  hasGenesisState(): Promise<boolean>;
  generateCanonicalGenesis(): Promise<void>;
  generateGenesis(initState: any): Promise<void>;
  accountIsEmpty(address: Address): Promise<boolean>;
  accountExists(address: Address): Promise<boolean>;
  isWarmedAddress(address: Buffer): boolean;
  addWarmedAddress(address: Buffer): void;
  isWarmedStorage(address: Buffer, slot: Buffer): boolean;
  addWarmedStorage(address: Buffer, slot: Buffer): void;
  clearWarmedAccounts(): void;
  generateAccessList(addressesRemoved?: Address[], addressesOnlyStorage?: Address[]): any; // TODO: types
  cleanupTouchedAccounts(): Promise<void>;
}
