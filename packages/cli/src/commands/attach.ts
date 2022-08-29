import path from 'path';
import { Command } from 'commander';
import { logger } from '@rei-network/utils';
import { IpcClient } from '@rei-network/ipc';

export function installIpcCommand(program: any) {
  const attach = new Command('attach')
    .description('Manage ipc connection')
    .command('attach [ipcpath]')
    .description('Attach to IPC server')
    .action((ipcpath) => {
      try {
        if (!ipcpath) {
          const client = new IpcClient(program.opts().datadir);
          client.start();
        } else {
          ipcpath = path.resolve(ipcpath);
          const client = new IpcClient('', ipcpath);
          client.start();
        }
      } catch (err) {
        logger.error('IPC, attach, error:', err);
      }
    });
  program.addCommand(attach);
}
