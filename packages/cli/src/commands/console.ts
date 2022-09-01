import { logger } from '@rei-network/utils';
import { IpcClient } from '@rei-network/ipc';
import { startServices, stopServices } from '../services';

export function installConsoleCommand(program: any) {
  program
    .command('console')
    .description('Start an interactive JavaScript environment')
    .action(async () => {
      try {
        const opts = program.opts();
        const service = await startServices(opts);
        const client = new IpcClient({ datadir: opts.datadir });
        await client.run();
        await stopServices(service);
      } catch (err) {
        logger.error('Start error:', err);
        process.exit(1);
      }
    });
}
