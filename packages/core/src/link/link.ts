import util from 'util';
import cluster, { Worker } from 'cluster';
import { Channel, logger } from '@rei-network/utils';
import { Message, Handler } from './types';

/**
 * TODO: fix this
 */
(cluster.settings as any).serialization = 'advanced';

type WaitingRequest = {
  resolve: (resps: any) => void;
  reject: (reason?: any) => void;
};

export abstract class Link {
  private readonly handlers: Map<string, Handler>;
  private readonly waitingRequests = new Map<number, WaitingRequest>();
  private readonly channel = new Channel<Message>();

  private autoId = Number.MIN_SAFE_INTEGER;
  private runningPromise?: Promise<void>;

  protected abstract _listen(listener: (message: Message) => void): void;
  protected abstract _removeListener(listener: (message: Message) => void): void;
  protected abstract _send(message: Message): void;

  constructor(handlers: Map<string, Handler>) {
    this.handlers = handlers;
  }

  private getAutoIncrementId() {
    const id = this.autoId;
    if (this.autoId === Number.MAX_SAFE_INTEGER) {
      this.autoId = Number.MIN_SAFE_INTEGER;
    } else {
      this.autoId++;
    }
    return id;
  }

  private async messageLoop() {
    for await (const message of this.channel.generator()) {
      try {
        await this.handleMessage(message);
      } catch (err: any) {
        logger.error('Link::messageLoop, catch error:', err);
      }
    }
  }

  private onMessage = (message: Message) => {
    this.channel.push(message);
  };

  start() {
    if (this.runningPromise) {
      throw new Error('already started');
    }
    this.runningPromise = this.messageLoop();
    this._listen(this.onMessage);
  }

  async abort() {
    if (this.runningPromise) {
      this._removeListener(this.onMessage);
      this.channel.abort();
      await this.runningPromise;
      this.runningPromise = undefined;
    }
  }

  request(method: string, data: any) {
    const id = this.getAutoIncrementId();
    this._send({
      id,
      method,
      data
    });
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(id, { resolve, reject });
    });
  }

  send(message: Partial<Message>) {
    this._send({
      ...message,
      id: message.id ?? this.getAutoIncrementId()
    });
  }

  async handleMessage(message: Message) {
    const { id, method, data, err } = message;
    const req = this.waitingRequests.get(id);
    if (req) {
      const { resolve, reject } = req;
      err ? reject(new Error(err)) : resolve(data);
      this.waitingRequests.delete(id);
    } else if (method !== undefined) {
      const handler = this.handlers.get(method);
      if (!handler) {
        this.send({ err: 'unknown method name: ' + method, id });
      } else {
        try {
          let result = handler.call(this, data);
          if (util.types.isPromise(result)) {
            result = await result;
          }
          this.send({ data: result, id });
        } catch (err: any) {
          console.log('err:', err);
          this.send({ err: err.message, id });
        }
      }
    } else {
      this.send({ err: 'missing method name', id });
    }
  }
}

export abstract class WorkerSide extends Link {
  protected _send(message: Message) {
    process.send!(message);
  }

  protected _listen(listener: (message: Message) => void) {
    process.on('message', listener);
  }

  protected _removeListener(listener: (message: Message) => void) {
    process.removeListener('message', listener);
  }
}

export abstract class MasterSide extends Link {
  readonly worker: Worker;

  protected _send(message: Message) {
    this.worker.send(message);
  }

  constructor(pathToWorker: string, handlers: Map<string, Handler>) {
    super(handlers);
    cluster.setupMaster({ exec: pathToWorker });
    this.worker = cluster.fork();
  }

  protected _listen(listener: (message: Message) => void) {
    this.worker.on('message', listener);
  }

  protected _removeListener(listener: (message: Message) => void) {
    this.worker.removeListener('message', listener);
  }
}
