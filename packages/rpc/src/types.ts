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
