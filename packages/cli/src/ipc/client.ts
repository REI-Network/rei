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
  constructor() {
    ipc.config.id = ipcId;
    ipc.config.silent = true;
  }

  start() {
    ipc.connectTo(ipcId, () => {
      ipc.of[ipcId].on('connect', () => {
        ipc.of[ipcId].emit('Connected to ipc server');
      });
      newRepl();
    });

    ipc.of[ipcId].on('messaage', (data: string) => {
      const message = JSON.parse(data);
      logger.debug(message);
    });

    ipc.of[ipcId].on('error', (err: Error) => {});
  }

  send(message: JSON) {
    ipc.of[ipcId].emit('message', message);
  }
}

function newRepl() {
  const replServer = repl.start({ prompt: '> ', useColors: true });
  replServer.context.admin = replProxy.admin;
  replServer.context.debug = replProxy.debug;
  replServer.context.eth = replProxy.eth;
  replServer.context.net = replProxy.net;
  replServer.context.txpool = replProxy.txpool;
  replServer.context.web3 = replProxy.web3;

  replServer.on('exit', () => {
    logger.info('Received exit signal, exiting...');
    process.exit(0);
  });
}
