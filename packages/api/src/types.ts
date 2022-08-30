import { BlockHeader, Log } from '@rei-network/structure';

export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export type TopicsData = (string | null | (string | null)[])[];

export type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string;
};

export interface Client {
  get isClosed(): boolean;
  send(data: any): void;
  close(): void;
  notifyHeader(subscription: string, heads: BlockHeader[]): void;
  notifyLogs(subscription: string, logs: Log[]): void;
  notifyPendingTransactions(subscription: string, hashes: Buffer[]): void;
  notifySyncing(subscription: string, status: SyncingStatus): void;
}

export const revertErrorSelector = Buffer.from('08c379a0', 'hex');

export interface RpcServer {
  isRunning: boolean;
  host: string;
  port: number;
  reset(newHost: string, newPort: number): void;
  start(): Promise<void>;
  abort(): Promise<void>;
}
