import { bufferToHex } from 'ethereumjs-util';
import { BlockHeader } from '@gxchain2/block';
import { Log } from '@gxchain2/receipt';
import { JSONRPC_VERSION } from './helper';

export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export class WsClient {
  public readonly ws: WebSocket;
  private closed = false;

  get isClosed() {
    return this.closed;
  }

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  send(data: any) {
    if (!this.closed) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {}
    }
  }

  close() {
    this.closed = true;
  }

  notifyHeader(subscription: string, heads: BlockHeader[]) {
    for (const header of heads) {
      this.send({
        jsonrpc: JSONRPC_VERSION,
        method: 'eth_subscription',
        params: {
          subscription,
          result: header.toJSON()
        }
      });
    }
  }

  notifyLogs(subscription: string, logs: Log[]) {
    for (const log of logs) {
      this.send({
        jsonrpc: JSONRPC_VERSION,
        method: 'eth_subscription',
        params: {
          subscription,
          result: log.toRPCJSON()
        }
      });
    }
  }

  notifyPendingTransactions(subscription: string, hashes: Buffer[]) {
    for (const hash of hashes) {
      this.send({
        jsonrpc: JSONRPC_VERSION,
        method: 'eth_subscription',
        params: {
          subscription,
          result: bufferToHex(hash)
        }
      });
    }
  }

  notifySyncing(subscription: string, status: SyncingStatus) {
    this.send({
      jsonrpc: JSONRPC_VERSION,
      method: 'eth_subscription',
      params: {
        subscription,
        result: status
      }
    });
  }
}
