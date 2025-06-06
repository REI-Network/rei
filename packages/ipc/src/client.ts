import repl from 'repl';
import path from 'path';
import ipc from 'node-ipc';
import { ipcId, ipcAppspace } from './constants';
import * as modules from './modules';

export interface IpcClientOptions {
  datadir?: string;
  ipcPath?: string;
}

export class IpcClient {
  private ipcPath: string;
  private replServer!: repl.REPLServer;

  constructor({ datadir, ipcPath }: IpcClientOptions) {
    if (datadir === undefined && ipcPath === undefined) {
      throw new Error('invalid options');
    }
    this.ipcPath = ipcPath ?? path.join(datadir!, ipcAppspace + ipcId);
    ipc.config.id = ipcId;
    ipc.config.silent = true;
    ipc.config.sync = true;
  }

  /**
   * Run ipc client
   */
  async run() {
    await new Promise<void>((resolve) => {
      ipc.connectTo(ipcId, this.ipcPath, () => {
        this.replServer = repl.start({
          prompt: '> ',
          useColors: true,
          ignoreUndefined: true,
          preview: false
        });
        this.replServer.context.admin = modules.admin;
        this.replServer.context.debug = modules.debug;
        this.replServer.context.eth = modules.eth;
        this.replServer.context.net = modules.net;
        this.replServer.context.rei = modules.rei;
        this.replServer.context.txpool = modules.txpool;
        this.replServer.context.web3 = modules.web3;

        this.replServer.on('exit', () => {
          console.log('Received exit signal');
          ipc.disconnect(ipcId);
        });

        ipc.of[ipcId].on('load', (data: string) => {
          console.log(data);
          this.replServer.displayPrompt();
        });

        ipc.of[ipcId].on('message', (data: string) => {
          console.log(JSON.stringify(JSON.parse(data), undefined, '\t'));
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
          console.log('Disconnected from server');
          this.replServer.close();
          resolve();
        });
      });
    });
    console.log('IPC client exit...');
  }
}
