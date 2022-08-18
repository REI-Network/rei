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
  private replServer = repl.start({ prompt: '> ', useColors: true, ignoreUndefined: true, preview: false });
  constructor() {
    ipc.config.id = ipcId;
    ipc.config.silent = true;
  }

  start() {
    ipc.connectTo(ipcId, () => {
      ipc.of[ipcId].on('connect', () => {
        logger.info('\n' + 'Welcome to the Rei Javascript console!');
      });
      this.newRepl();
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('messaage', (data: string) => {
      console.log(JSON.parse(data));
      this.replServer.displayPrompt();
    });

    ipc.of[ipcId].on('error', (err: Error) => {
      console.log('Error: ' + err);
    });

    ipc.of[ipcId].on('disconnect', () => {
      console.log('Disconnected from server, exiting...');
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
