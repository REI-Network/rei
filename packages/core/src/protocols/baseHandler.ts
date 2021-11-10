import { bufferToInt } from 'ethereumjs-util';
import { logger } from '@gxchain2/utils';
import { ProtocolHandler, Peer, Protocol } from '@gxchain2/network';
import { Node } from '../node';
import { HandlerFunc, BaseHandlerOptions, PeerRequestTimeoutError } from './types';

/**
 * WireProtocolHandler is used to manage protocol communication between nodes
 */
export abstract class BaseHandler<T extends Protocol> implements ProtocolHandler {
  readonly protocol: T;
  readonly node: Node;
  readonly peer: Peer;
  readonly name: string;

  protected handlerFuncs: HandlerFunc[];

  protected readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  protected handshakeResolve?: (result: boolean) => void;
  protected handshakeTimeout?: NodeJS.Timeout;
  protected readonly handshakePromise: Promise<boolean>;

  protected abstract onHandshakeSucceed(): void;
  protected abstract onHandshake(): void;
  protected abstract onHandshakeResponse(resps: any): boolean;
  protected abstract onAbort(): void;

  protected abstract encode(method: string | number, data: any): any;
  protected abstract decode(data: Buffer): [number, any];

  constructor(options: BaseHandlerOptions<T>) {
    this.protocol = options.protocol;
    this.node = options.node;
    this.peer = options.peer;
    this.name = options.name;
    this.handlerFuncs = options.handlerFuncs;

    this.handshakePromise = new Promise<boolean>((resolve) => {
      this.handshakeResolve = resolve;
    });
    this.handshakePromise.then((result) => {
      if (result) {
        this.onHandshakeSucceed();
      }
    });
  }

  /**
   * Get method hander according to method name
   * @param method Method name
   * @returns
   */
  protected findHandler(method: string | number) {
    const handler = this.handlerFuncs.find((h) => (typeof method === 'string' ? h.name === method : h.code === method));
    if (!handler) {
      throw new Error(`Missing handler, method: ${method}`);
    }
    return handler;
  }

  protected send(method: string | number, data: any) {
    this.peer.send(this.name, this.encode(method, data));
  }

  /**
   * Node handshake and establish connection
   */
  handshake() {
    if (!this.handshakeResolve) {
      throw new Error('HandlerBase repeat handshake');
    }
    this.onHandshake();
    this.handshakeTimeout = setTimeout(() => {
      if (this.handshakeResolve) {
        this.handshakeResolve(false);
        this.handshakeResolve = undefined;
      }
    }, 8000);
    return this.handshakePromise;
  }

  /**
   * Response to handshake and update status
   * @param status Node Status
   */
  handshakeResponse(status: any) {
    if (this.handshakeResolve) {
      if (!this.onHandshakeResponse(status)) {
        this.handshakeResolve(false);
      } else {
        this.handshakeResolve(true);
      }
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }
  }

  /**
   * Send protocol request call method to get information
   * @param method Method name
   * @param data Data
   */
  request(method: string, data: any) {
    const handler = this.findHandler(method);
    if (!handler.response) {
      throw new Error(`HandlerBase invalid request: ${method}`);
    }
    if (this.waitingRequests.has(handler.response!)) {
      throw new Error(`HandlerBase repeated request: ${method}`);
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(handler.response!, {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(handler.response!);
          reject(new PeerRequestTimeoutError(`HandlerBase timeout request: ${method}`));
        }, 8000)
      });
      this.send(method, data);
    });
  }

  abort() {
    if (this.handshakeResolve) {
      this.handshakeResolve(false);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }
    for (const [, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('HandlerBase abort'));
    }
    this.waitingRequests.clear();
    this.onAbort();
  }

  /**
   * Handle requests by handler's process function
   * @param data Data to be processed
   */
  async handle(data: Buffer) {
    const [code, payload]: any = this.decode(data);
    const numCode = bufferToInt(code);
    const handler = this.findHandler(numCode);
    data = handler.decode.call(this, payload);

    const request = this.waitingRequests.get(numCode);
    if (request) {
      clearTimeout(request.timeout);
      this.waitingRequests.delete(numCode);
      request.resolve(data);
    } else if (handler.process) {
      if (numCode !== 0 && !(await this.handshakePromise)) {
        logger.warn('HandlerBase::handle, handshake failed');
        return;
      }
      const result = handler.process.call(this, data);
      if (result) {
        if (Array.isArray(result)) {
          const [method, resps] = result;
          this.send(method, resps);
        } else {
          result
            .then((response) => {
              if (response) {
                const [method, resps] = response;
                this.send(method, resps);
              }
            })
            .catch((err) => {
              logger.error('HandlerBase::process, catch error:', err);
            });
        }
      }
    }
  }
}
