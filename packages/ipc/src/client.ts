import ipc from 'node-ipc';
import repl from 'repl';
import path from 'path';
import { ipcId, ipcAppspace } from './constants';
import * as modules from './modules';

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
    this.replServer.context.admin = modules.adminModule;
    this.replServer.context.debug = modules.debugModule;
    this.replServer.context.eth = modules.ethModule;
    this.replServer.context.net = modules.netModule;
    this.replServer.context.rei = modules.reiModule;
    this.replServer.context.txpool = modules.txpoolModule;
    this.replServer.context.web3 = modules.web3Module;

    this.replServer.on('exit', () => {
      console.log('Received exit signal, exiting...');
      process.exit(0);
    });
  }
}
