import path from 'path';
import { logger } from '@rei-network/utils';
import { IpcClient } from '@rei-network/ipc';

export function installAttachCommand(program: any) {
  program
    .command('attach [ipcpath]')
    .description(
      'Start an interactive JavaScript environment (connect to node)'
    )
    .action(async (ipcPath) => {
      try {
        const client = new IpcClient({
          datadir: program.opts().datadir,
          ipcPath: ipcPath ? path.resolve(ipcPath) : undefined
        });
        await client.run();
      } catch (err) {
        logger.error('Attach, error:', err);
        process.exit(1);
      }
    });
}
