import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import { Node } from '@gxchain2/core';
import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { api } from './controller';
import { logger } from '@gxchain2/utils';
import { WsClient } from './client';
import { FilterSystem } from './filtersystem';

export class RpcContext {
  public readonly client?: WsClient;

  get isWebsocket() {
    return !!this.client;
  }

  constructor(client?: WsClient) {
    this.client = client;
  }
}

export const emptyContext = new RpcContext();

export class RpcServer {
  private readonly port: number;
  private readonly host: string;
  private running: boolean = false;
  private readonly controllers: { [name: string]: any }[];

  get isRunning() {
    return this.running;
  }

  constructor(port: number, host: string, apis: string, node: Node) {
    this.port = port;
    this.host = host;
    const filterSystem = new FilterSystem(node);
    this.controllers = apis.split(',').map((name) => {
      if (!(name in api)) {
        throw new Error('RpcServer, Unknow api:' + name);
      }
      return new api[name](node, filterSystem);
    });
  }

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

        app.use(express.json({ type: '*/*' }));
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
}
