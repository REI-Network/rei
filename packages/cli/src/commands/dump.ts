import fs from 'fs';
import path from 'path';
import { logger } from '@rei-network/utils';

export async function installDumpCommand(program: any) {
  program
    .command('dump-leveldb')
    .description('Dump leveldb database')
    .action(() => {
      const { datadir } = program.opts();
      try {
        logger.info('Dump leveldb database start');
        dump(path.join(datadir, 'chaindb'));
        dump(path.join(datadir, 'nodes'));
        dump(path.join(datadir, 'evidence'));
        logger.info('Dump leveldb database done');
      } catch (err) {
        logger.error('Dump leveldb database:', err);
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
