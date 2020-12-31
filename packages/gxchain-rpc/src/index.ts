import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import * as helper from './helper';
import { EventEmitter } from 'events';

export class RpcServer extends EventEmitter {
  protected readonly port: number;
  protected readonly host: string;
  protected running: boolean = false;
  protected controller: any;
  constructor(port: number, host: string, controller: { [name: string]: (params: any) => Promise<any> | any }) {
    super();
    this.port = port;
    this.host = host;
    this.controller = controller;
  }

  start() {
    if (this.running) {
      throw new Error('RPC and WS server already started!');
    }
    try {
      const app = express();
      const server = http.createServer(app);
      const enableWs = expressws(app, server);
      this.running = true;
      app.use(express.json());
      const jsonmid = new JsonRPCMiddleware({ methods: this.controller });

      app.use(jsonmid.makeMiddleWare());
      app.ws('/', (ws, msg) => {
        ws.on('message', (msg) => {
          try {
            jsonmid.rpcMiddleware(JSON.parse(msg), (res: any) => {
              try {
                ws.send(JSON.stringify(res));
              } catch (err) {
                this.emit('error', err);
              }
            });
          } catch (err) {
            this.emit('error', err);
          }
        });

        ws.on('close', () => {
          console.log('WebSocket was closed');
        });
      });

      server.listen(this.port, this.host, function () {
        console.log('listening on *:');
      });
    } catch (err) {
      this.running = false;
      this.emit('error', err);
    }
  }
}
