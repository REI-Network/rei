export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export const JSONRPC_VERSION = '2.0';
