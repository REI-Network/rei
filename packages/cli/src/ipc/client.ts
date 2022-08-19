import ipc from 'node-ipc';
import repl from 'repl';
import { ipcId } from './server';
import { logger } from '@rei-network/utils';

function passMessageToJson(method: string, ...args) {
  return {
    method: method,
    params: args
  };
}

const proxy: any = new Proxy(
  {},
  {
    get: (target, prop: string, receiver, ...args) => {
      return function (...arg) {
        const message = passMessageToJson(prop, ...arg);
        ipc.of[ipcId].emit('message', JSON.stringify(message));
      };
    }
  }
);

const replProxy = {
  debug: proxy,
  admin: proxy,
  eth: proxy,
  net: proxy,
  txpool: proxy,
  web3: proxy
};

export class IpcClient {
  private readonly path: string;
  private replServer = repl.start({ prompt: '> ', useColors: true, ignoreUndefined: true, preview: false });
  constructor(path: string) {
    this.path = path;
    ipc.config.id = ipcId;
    ipc.config.silent = true;
  }

  start() {
    ipc.connectTo(ipcId, this.path, () => {
      ipc.of[ipcId].on('connect', () => {
        this.newRepl();
      });
    });

    ipc.of[ipcId].on('load', (data: string) => {
      console.log(data);
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('message', (data: string) => {
      console.log(JSON.parse(data));
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('error', (err) => {
      console.log('Error: ' + err);
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('errorMessage', (err: string) => {
      console.log('Error: ' + JSON.parse(err));
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('disconnect', () => {
      logger.info('Disconnected from server, exiting...');
      process.exit(0);
    });
  }

  newRepl() {
    this.replServer.context.admin = replProxy.admin;
    this.replServer.context.debug = replProxy.debug;
    this.replServer.context.eth = replProxy.eth;
    this.replServer.context.net = replProxy.net;
    this.replServer.context.txpool = replProxy.txpool;
    this.replServer.context.web3 = replProxy.web3;

    this.replServer.on('exit', () => {
      logger.info('Received exit signal, exiting...');
      process.exit(0);
    });
  }
}
