import path from 'path';
import { Command } from 'commander';
import { logger } from '@rei-network/utils';
import { IpcClient } from '@rei-network/ipc';

/**
 *
 * @param opts
 * @returns
 */
function getKeyStorePath(opts: { [option: string]: string }) {
  return path.join(opts.datadir, 'rei.ipc');
}

export function installIpcCommand(program: any) {
  const ipc = new Command('ipc').description('Manage ipc connection');
  program.addCommand(ipc);

  ipc
    .command('attach [ipcpath]')
    .description('Attach to IPC server')
    .action((ipcpath) => {
      try {
        if (!ipcpath) {
          const client = new IpcClient(getKeyStorePath(program.opts()));
          client.start();
        } else {
          ipcpath = path.resolve(ipcpath);
          const client = new IpcClient(ipcpath);
          client.start();
        }
      } catch (err) {
        logger.error('IPC, attach, error:', err);
      }
    });
}
