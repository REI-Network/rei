import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import { EventEmitter } from 'events';

import { Node } from '@gxchain2/core';

import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { Controller } from './controller';

export class RpcServer extends EventEmitter {
  protected readonly port: number;
  protected readonly host: string;
  protected running: boolean = false;
  protected controller: Controller;
  constructor(port: number, host: string, node: Node) {
    super();
    this.port = port;
    this.host = host;
    this.controller = new Controller(node);
  }

  start() {
    return new Promise<void>((resolve) => {
      if (this.running) {
        this.emit('error', new Error('RPC and WS server already started!'));
        resolve();
        return;
      }
      try {
        this.running = true;
        const app = express();
        const server = http.createServer(app);
        const enableWs = expressws(app, server);
        app.use(express.json({ type: '*/*' }));
        const jsonmid = new JsonRPCMiddleware({ methods: this.controller as any });

        app.use(jsonmid.makeMiddleWare());
        app.ws('/', (ws) => {
          jsonmid.wrapWs(ws, (err) => this.emit('error', err));

          ws.on('close', () => {
            console.log('WebSocket was closed');
          });
        });

        server.once('error', (err: Error) => {
          this.emit('error', err);
          resolve();
        });
        server.listen(this.port, this.host, () => {
          console.log(`rpc server listening on ${this.host}:${this.port}`);
          resolve();
        });
      } catch (err) {
        this.running = false;
        this.emit('error', err);
        resolve();
      }
    });
  }
}
