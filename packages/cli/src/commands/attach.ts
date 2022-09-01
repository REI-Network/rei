import path from 'path';
import { Command } from 'commander';
import { logger } from '@rei-network/utils';
import { IpcClient } from '@rei-network/ipc';

export function installAttachCommand(program: any) {
  const attach = new Command('attach [ipcpath]').description('Start an interactive JavaScript environment (connect to node)').action((ipcPath) => {
    try {
      const client = new IpcClient({
        datadir: program.opts().datadir,
        ipcPath: ipcPath ? path.resolve(ipcPath) : undefined
      });
      client.start();
    } catch (err) {
      logger.error('IPC, attach, error:', err);
    }
  });
  program.addCommand(attach);
}
