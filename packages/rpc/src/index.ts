import util from 'util';
import http from 'http';
import net from 'net';
import express from 'express';
import expressws from 'express-ws';
import bodyParse from 'body-parser';
import { BN, bufferToHex } from 'ethereumjs-util';
import { logger, Channel } from '@rei-network/utils';
import { AbiCoder } from '@ethersproject/abi';
import { ApiServer, OutOfGasError as ApiOutOfGasError, RevertError as ApiRevertError } from '@rei-network/api';
import { api } from './controller';
import { JsonRPCMiddleware } from './jsonRPCMiddleware';
import { WebsocketClient } from './client';
import { Request } from './types';
import * as helper from './helper';
import errors from './errorCodes';

const defaultPort = 11451;
const defaultHost = '127.0.0.1';
const defaultApis = 'eth,net,web3,rei';

// long time-consuming requests that need to be queued for processing
const queuedMethods = new Set<string>(['eth_getLogs', 'eth_getFilterLogs', 'debug_traceBlock', 'debug_traceBlockByNumber', 'debug_traceBlockByHash', 'debug_traceTransaction', 'debug_traceCall']);

const coder = new AbiCoder();

export class RevertError {
  readonly code = errors.REVERT_ERROR.code;
  readonly rpcMessage: string;
  readonly data?: string;

  constructor(returnValue: string | Buffer, decodedReturnValue: string | undefined) {
    this.rpcMessage = decodedReturnValue ? 'execution reverted: ' + decodedReturnValue : (returnValue as string);
    this.data = decodedReturnValue && bufferToHex(returnValue as Buffer);
  }
}

export class OutOfGasError {
  readonly code = errors.SERVER_ERROR.code;
  readonly gas: BN;

  constructor(gas: BN) {
    this.gas = gas.clone();
  }

  get rpcMessage() {
    return `gas required exceeds allowance (${this.gas.toString()})`;
  }
}

export interface RpcServerOptions {
  // apiServer instance
  apiServer: ApiServer;
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
  readonly apiServer: ApiServer;
  private readonly sockets = new Set<net.Socket>();
  private readonly port: number;
  private readonly host: string;
  private readonly controllers: { [name: string]: any }[];
  private readonly reqQueue = new Channel<Request>({
    max: 1000,
    drop: (msg) => {
      msg.reject(new Error('too many reqs'));
    }
  });

  private server?: http.Server;
  private reqPromise?: Promise<void>;

  constructor(options: RpcServerOptions) {
    this.apiServer = options.apiServer;

    this.port = options.port ?? defaultPort;
    this.host = options.host ?? defaultHost;

    this.controllers = (options.apis ?? defaultApis).split(',').map((name) => {
      if (!(name in api)) {
        throw new Error('unknown api:' + name);
      }
      return new api[name](this.apiServer);
    });
  }

  /**
   * Whether the rpc server is running
   */
  get isRunning() {
    return !!this.server;
  }

  /**
   * Handle client request
   * @param param0 - Request instance
   */
  private async handleReq({ method, params, client, resolve, reject }: Request) {
    try {
      const startAt = Date.now();
      logger.detail('📦 Rpc served', method, 'params:', params);

      const controller = this.controllers.find((c) => method in c);
      if (!controller) {
        // method doesn't exist or unsupported method
        throw helper.makeNotFoundErr(method);
      }

      try {
        const result = controller[method](params, client);
        resolve(util.types.isPromise(result) ? await result : result);
      } catch (err) {
        if (err instanceof Error) {
          throw helper.makeRpcErr(err.message);
        } else if (err instanceof ApiOutOfGasError) {
          throw new OutOfGasError(err.gas);
        } else if (err instanceof ApiRevertError) {
          throw new RevertError(err.returnValue, err.decodedReturnValue);
        } else {
          throw err;
        }
      }

      logger.debug('📦 Rpc served', method, 'usage:', Date.now() - startAt);
    } catch (err) {
      logger.debug('JsonRPCMiddleware::handleSingleReq, method:', method, 'catch error:', err);

      reject(err);
    }
  }

  /**
   * A loop for time-consuming request
   */
  private async reqLoop() {
    for await (const req of this.reqQueue) {
      await this.handleReq(req);
    }
  }

  /**
   * Received a new request,
   * it will handle it immediately or add it to the queue
   * @param req - Request instance
   */
  newReq(req: Request) {
    if (this.isRunning) {
      if (queuedMethods.has(req.method)) {
        this.reqQueue.push(req);
      } else {
        this.handleReq(req);
      }
    } else {
      req.reject(new Error('server closed'));
    }
  }

  /**
   * Start rpc server
   */
  start() {
    return new Promise<void>((resolve, reject) => {
      if (this.isRunning) {
        reject(new Error('RPC and WS server already started!'));
        return;
      }

      try {
        const app = express();
        this.server = http.createServer(app);
        expressws(app, this.server);
        app.use(bodyParse.json({ type: '*/*', limit: '5mb' }));

        const jsonmid = new JsonRPCMiddleware(this.newReq.bind(this));
        app.use(jsonmid.makeMiddleWare());
        app.ws('/', (ws) => {
          const client = new WebsocketClient(ws);
          jsonmid.wrapWs(client);
          ws.on('error', (err) => {
            logger.detail('RpcServer, ws error:', err);
          });
          ws.on('close', () => {
            client.close();
          });
        });

        this.server.once('error', (err) => {
          this.server!.removeAllListeners();
          logger.error('RpcServer, error:', err);
          reject(err);
        });
        this.server.listen(this.port, this.host, () => {
          logger.info(`Rpc server listening on ${this.host.indexOf('.') === -1 ? '[' + this.host + ']' : this.host}:${this.port}`);
          this.server!.removeAllListeners('error');
          this.server!.on('error', (err) => {
            logger.error('RpcServer, error:', err);
          });
          this.server!.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('close', () => {
              this.sockets.delete(socket);
            });
          });

          // start loop
          this.reqPromise = this.reqLoop();
          resolve();
        });
      } catch (err) {
        this.server = undefined;
        this.reqPromise = undefined;
        reject(err);
      }
    });
  }

  /**
   * Abort rpc server
   */
  async abort() {
    if (!this.isRunning) {
      return;
    }

    this.sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resovle) => {
      this.server!.close((err) => {
        if (err) {
          logger.debug('RpcServer::close, catch err:', err);
        }
        resovle();
      });
    });
    this.server = undefined;

    this.reqQueue.abort();
    await this.reqPromise;
    this.reqPromise = undefined;
  }
}
