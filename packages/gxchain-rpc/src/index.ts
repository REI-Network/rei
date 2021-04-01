import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import { EventEmitter } from 'events';
import { Node } from '@gxchain2/core';
import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { Controller } from './controller';
import { logger } from '@gxchain2/utils';
import { WsClient } from './client';
import { FilterSystem } from './filtersystem';

export class RpcServer extends EventEmitter {
  private readonly port: number;
  private readonly host: string;
  private running: boolean = false;
  private controller: Controller;
  private filterSystem: FilterSystem;

  get isRunning() {
    return this.running;
  }

  constructor(port: number, host: string, node: Node) {
    super();
    this.port = port;
    this.host = host;
    this.filterSystem = new FilterSystem(node);
    this.controller = new Controller(node, this.filterSystem);
  }

  start() {
    return new Promise<boolean>((resolve) => {
      if (this.running) {
        this.emit('error', new Error('RPC and WS server already started!'));
        resolve(false);
        return;
      }

      try {
        this.running = true;
        const app = express();
        const server = http.createServer(app);
        expressws(app, server);
        const jsonmid = new JsonRPCMiddleware({ methods: this.controller as any });

        app.use(express.json({ type: '*/*' }));
        app.use(jsonmid.makeMiddleWare());
        app.ws('/', (ws) => {
          const wsClient = new WsClient(ws);
          jsonmid.wrapWs(wsClient);
          ws.on('error', (err) => this.emit('error', err));
          ws.on('close', () => {
            wsClient.close();
          });
        });

        server.once('error', (err) => {
          server.removeAllListeners();
          this.emit('error', err);
          resolve(false);
        });
        server.listen(this.port, this.host, () => {
          logger.info(`Rpc server listening on ${this.host.indexOf('.') === -1 ? '[' + this.host + ']' : this.host}:${this.port}`);
          server.removeAllListeners('error');
          server.on('error', (err) => {
            this.emit('error', err);
          });
          resolve(true);
        });
      } catch (err) {
        this.running = false;
        this.emit('error', err);
        resolve(false);
      }
    });
  }
}
