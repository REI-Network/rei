import { bufferToHex } from 'ethereumjs-util';
import { BlockHeader, Log } from '@gxchain2/structure';
import { SyncingStatus, JSONRPC_VERSION } from './types';

/**
 * Websocket client, used to manage websocket connections
 */
export class WsClient {
  public readonly ws: WebSocket;
  private closed = false;

  /**
   * Determine whether the connection is disconnected
   */
  get isClosed() {
    return this.closed;
  }

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  /**
   * Used to send Json message
   * @param data Data
   */
  send(data: any) {
    if (!this.closed) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {}
    }
  }

  /**
   * Close connection
   */
  close() {
    this.closed = true;
  }

  /**
   * Used to send block headers for subscription
   * @param subscription Subscription identity
   * @param heads Block headers
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
   * Used to send log information for subscription
   * @param subscription Subscription identity
   * @param logs Logs information
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
   * Used to send pending transactions for subscription
   * @param subscription Subscription identity
   * @param hashes Transactions hashes
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
   * Used to send Syncing state for subscription
   * @param subscription Subscription identity
   * @param status Syncing state
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
