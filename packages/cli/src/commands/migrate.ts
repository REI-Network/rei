import path from 'path';
import { logger } from '@rei-network/utils';
import { createEncodingLevelDB, createEncodingRocksDB, createLevelDB, createRocksDB, batchMigrate } from '@rei-network/database';

export async function installMigrateCommand(program: any) {
  program
    .command('migrate')
    .description('Migrate data from leveldb to rocksdb')
    .action(async () => {
      const { datadir } = program.opts();
      try {
        const dbs = [
          [createEncodingLevelDB(path.join(datadir, 'chaindb')), createEncodingRocksDB(path.join(datadir, 'chaindbRocks'))],
          [createLevelDB(path.join(datadir, 'nodes')), createRocksDB(path.join(datadir, 'nodesRocks'))],
          [createLevelDB(path.join(datadir, 'evidence')), createRocksDB(path.join(datadir, 'evidenceRocks'))]
        ];
        logger.info('Migrate, start');
        await batchMigrate(dbs);
        dbs.forEach((db) => {
          db.map((d) => d.close());
        });
        logger.info('Migrate, done');
      } catch (err) {
        //todo delete rocksdb
        logger.error('Migrate error:', err);
        process.exit(1);
      }
    });
}
