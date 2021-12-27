import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import bodyParse from 'body-parser';
import { logger } from '@rei-network/utils';
import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { api } from './controller';
import { WsClient } from './client';
import { FilterSystem } from './filtersystem';
import { Backend } from './types';

const defaultPort = 11451;
const defaultHost = '127.0.0.1';
const defaultApis = 'eth,net,web3';

/**
 * RPC running context, contain a websocket client instance
 */
export class RpcContext {
  public readonly client?: WsClient;

  /**
   * Whether it is a websock connection
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
  // Backend instance
  backend: Backend;
  // rpc server listening port
  port?: number;
  // rpc server listening host
  host?: string;
  // rpc server enable api
  apis?: string;
}

/**
 * Rpc server
 */
export class RpcServer {
  private readonly port: number;
  private readonly host: string;
  private running: boolean = false;
  private readonly controllers: { [name: string]: any }[];

  /**
   * Whether the rpc server is running
   */
  get isRunning() {
    return this.running;
  }

  constructor(options: RpcServerOptions) {
    this.port = options.port || defaultPort;
    this.host = options.host || defaultHost;
    const apis = options.apis || defaultApis;
    const filterSystem = new FilterSystem(options.backend);
    this.controllers = apis.split(',').map((name) => {
      if (!(name in api)) {
        throw new Error('RpcServer, Unknow api:' + name);
      }
      return new api[name](options.backend, filterSystem);
    });
  }

  /**
   * Start rpc server
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

  /**
   * Abort rpc server
   */
  abort() {}
}
