import { bufferToHex } from 'ethereumjs-util';
import { BlockHeader, Log } from '@rei-network/structure';
import { SyncingStatus, JSONRPC_VERSION } from './types';

/**
 * Websocket client, used to manage websocket connections
 */
export class WebsocketClient {
  readonly ws: WebSocket;
  closed = false;

  /**
   * Whether the connection is disconnected
   */
  get isClosed() {
    return this.closed;
  }

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  /**
   * Send message to remote client
   * @param data - Data
   */
  send(data: any) {
    if (!this.closed) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {
        // ignore all errors ...
      }
    }
  }

  /**
   * Close connection
   */
  close() {
    this.closed = true;
  }

  /**
   * Notify block headers to remote client
   * @param subscription - Subscription identity
   * @param heads - Block headers
   */
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

  /**
   * Notify logs to remote client
   * @param subscription - Subscription identity
   * @param logs - Logs
   */
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

  /**
   * Notify pending transactions to remote client
   * @param subscription - Subscription identity
   * @param hashes - Transactions hashes
   */
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

  /**
   * Notify sync state to remote client
   * @param subscription - Subscription identity
   * @param status - Sync state
   */
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
