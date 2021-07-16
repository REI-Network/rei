import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import bodyParse from 'body-parser';
import { Node } from '@gxchain2/core';
import { logger } from '@gxchain2/utils';
import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { api } from './controller';
import { WsClient } from './client';
import { FilterSystem } from './filtersystem';

const defaultPort = 11451;
const defaultHost = '127.0.0.1';
const defaultApis = 'eth,net,web3';

/**
 * RPC running context, https or websocket
 */
export class RpcContext {
  public readonly client?: WsClient;

  /**
   * Determine whether it is a websock connection
   */
  get isWebsocket() {
    return !!this.client;
  }

  constructor(client?: WsClient) {
    this.client = client;
  }
}

export const emptyContext = new RpcContext();

export interface RpcServerOptions {
  node: Node;
  port?: number;
  host?: string;
  apis?: string;
}

/**
 * Manage rpc server
 */
export class RpcServer {
  private readonly port: number;
  private readonly host: string;
  private running: boolean = false;
  private readonly controllers: { [name: string]: any }[];

  /**
   * Determine whether the rpc server is running
   */
  get isRunning() {
    return this.running;
  }

  constructor(options: RpcServerOptions) {
    this.port = options.port || defaultPort;
    this.host = options.host || defaultHost;
    const apis = options.apis || defaultApis;
    const filterSystem = new FilterSystem(options.node);
    this.controllers = apis.split(',').map((name) => {
      if (!(name in api)) {
        throw new Error('RpcServer, Unknow api:' + name);
      }
      return new api[name](options.node, filterSystem);
    });
  }

  /**
   * start rpc service, listening on the rpc request
   */
  start() {
    return new Promise<void>((resolve, reject) => {
      if (this.running) {
        reject(new Error('RPC and WS server already started!'));
        return;
      }

      try {
        this.running = true;
        const app = express();
        const server = http.createServer(app);
        expressws(app, server);
        const jsonmid = new JsonRPCMiddleware({ methods: this.controllers });

        app.use(bodyParse.json({ type: '*/*', limit: '5mb' }));
        app.use(jsonmid.makeMiddleWare());
        app.ws('/', (ws) => {
          const context = new RpcContext(new WsClient(ws));
          jsonmid.wrapWs(context);
          ws.on('error', (err) => {
            logger.detail('RpcServer, ws error:', err);
          });
          ws.on('close', () => {
            context.client!.close();
          });
        });

        server.once('error', (err) => {
          server.removeAllListeners();
          logger.error('RpcServer, error:', err);
          reject(err);
        });
        server.listen(this.port, this.host, () => {
          logger.info(`Rpc server listening on ${this.host.indexOf('.') === -1 ? '[' + this.host + ']' : this.host}:${this.port}`);
          server.removeAllListeners('error');
          server.on('error', (err) => {
            logger.error('RpcServer, error:', err);
          });
          resolve();
        });
      } catch (err) {
        this.running = false;
        reject(err);
      }
    });
  }

  abort() {}
}
