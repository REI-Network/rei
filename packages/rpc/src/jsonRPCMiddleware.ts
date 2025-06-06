import * as helper from './helper';
import errors from './errorCodes';
import { JSONRPC_VERSION, Request } from './types';
import { WebsocketClient } from './client';

type JsonRPCBody = { id: any; method: string; jsonrpc: string; params: any };

export class JsonRPCMiddleware {
  private readonly newReq: (req: Request) => void;

  constructor(newReq: (req: Request) => void) {
    this.newReq = newReq;
  }

  /**
   * Deal with a single RPC request
   * @param body Request body
   * @param client Websoket client
   * @returns Handled result
   */
  private async handleSingleReq(
    body: JsonRPCBody,
    client?: WebsocketClient
  ): Promise<any> {
    const { id, method, jsonrpc, params } = body;
    try {
      helper.validateJsonRpcVersion(jsonrpc);
      helper.validateJsonRpcMethod(method);

      const result = await new Promise<any>((resolve, reject) => {
        this.newReq({
          method,
          params,
          client,
          resolve,
          reject
        });
      });

      return { jsonrpc, result, id };
    } catch (err: any) {
      const error = {
        code: Number(err.code || err.status || errors.INTERNAL_ERROR.code),
        message: err.rpcMessage || errors.INTERNAL_ERROR.message,
        data: err.data
      };

      if (err && err.data) {
        error.data = err.data;
      }

      return { jsonrpc, error, id };
    }
  }

  /**
   * Process a series of requests
   * @param batchBody Request body
   * @param client Websocket client
   * @returns Array of Handled results
   */
  private handleBatchReq(
    batchBody: any[],
    client?: WebsocketClient
  ): Promise<any[]> {
    return Promise.all(
      batchBody.reduce((memo, body) => {
        memo.push(this.handleSingleReq(body, client));
        return memo;
      }, [])
    );
  }

  /**
   * Create PARSE_ERROR object
   * @returns
   */
  private makeParseError() {
    return {
      jsonrpc: JSONRPC_VERSION,
      error: errors.PARSE_ERROR,
      message: errors.PARSE_ERROR.message
    };
  }

  private async handleReq(
    req: any,
    send: (res: any) => void,
    client?: WebsocketClient
  ) {
    if (Array.isArray(req)) {
      send(await this.handleBatchReq(req, client));
    } else if (typeof req === 'object') {
      send(await this.handleSingleReq(req, client));
    } else {
      send(this.makeParseError());
    }
  }

  /**
   * Format the rpc request passed in by websocket and then process it
   * @param client Websocket client
   */
  wrapWs(client: WebsocketClient) {
    client.ws.addEventListener('message', (msg) => {
      let req: any;
      try {
        req = JSON.parse(msg.data);
      } catch (err) {
        client.send(this.makeParseError());
        return;
      }
      this.handleReq(req, client.send.bind(client), client);
    });
  }

  /**
   * Format the rpc request passed in by http and then process it
   */
  makeMiddleWare() {
    return (req: any, res: any, next: any) => {
      if (req.ws) {
        next();
      } else {
        this.handleReq(req.body, res.send.bind(res));
      }
    };
  }
}
