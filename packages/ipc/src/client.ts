import ipc from 'node-ipc';
import repl from 'repl';
import path from 'path';
import { ipcId, ipcAppspace } from './constants';

/**
 * Convert command line commands to json message
 * @param method - method name
 * @param args - args for method use
 * @returns Json message
 */
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

export class IpcClient {
  private readonly ipcPath: string;
  private replServer!: repl.REPLServer;
  constructor(datadir: string, ipcPath?: string) {
    this.ipcPath = ipcPath ? ipcPath : path.join(datadir, ipcAppspace + ipcId);
    ipc.config.id = ipcId;
    ipc.config.silent = true;
    ipc.config.sync = true;
  }

  /**
   * Start ipc client
   */
  start() {
    ipc.connectTo(ipcId, this.ipcPath, () => {
      this.newRepl();
      // ipc.of[ipcId].on('connect', () => {});
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
        console.log('Error: ' + err);
        this.replServer.displayPrompt();
      });

      ipc.of[ipcId].on('disconnect', () => {
        console.log('Disconnected from server, exiting...');
        process.exit(0);
      });
    });
  }

  /**
   * New Repl for interactive command line
   */
  newRepl() {
    this.replServer = repl.start({ prompt: '> ', useColors: true, ignoreUndefined: true, preview: false });
    this.replServer.context.admin = proxy;
    this.replServer.context.debug = proxy;
    this.replServer.context.eth = proxy;
    this.replServer.context.net = proxy;
    this.replServer.context.txpool = proxy;
    this.replServer.context.web3 = proxy;

    this.replServer.on('exit', () => {
      console.log('Received exit signal, exiting...');
      process.exit(0);
    });
  }
}
