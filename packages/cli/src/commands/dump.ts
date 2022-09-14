import fs from 'fs';
import path from 'path';
import { logger } from '@rei-network/utils';

export async function installDumpCommand(program: any) {
  program
    .command('dump')
    .description('Dump rocksdb database')
    .action(() => {
      const { datadir } = program.opts();
      try {
        logger.info('Dump rocksdb database start');
        dump(path.join(datadir, 'chaindb-rocks'));
        dump(path.join(datadir, 'nodes-rocks'));
        dump(path.join(datadir, 'evidence-rocks'));
        logger.info('Dump rocksdb database done');
      } catch (err) {
        logger.error('Dump rocksdb database:', err);
        process.exit(1);
      }
    });
}

function dump(path: string) {
  if (fs.existsSync(path)) {
    fs.rmdirSync(path, { recursive: true });
  }
  logger.info(`Dump ${path} done`);
}
