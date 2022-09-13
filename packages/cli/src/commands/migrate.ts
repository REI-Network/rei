import path from 'path';
import { LevelUp } from 'levelup';
import { logger } from '@rei-network/utils';
import { createEncodingLevelDB, createEncodingRocksDB, createLevelDB, createRocksDB, batchMigrate } from '@rei-network/database';

export async function installMigrateCommand(program: any) {
  program
    .command('migrate')
    .description('Migrate data from leveldb to rocksdb')
    .action(async () => {
      const { datadir } = program.opts();
      let dbs: [LevelUp, LevelUp][] = [];
      try {
        dbs = [
          [createEncodingLevelDB(path.join(datadir, 'chaindb')), createEncodingRocksDB(path.join(datadir, 'chaindb-rocks'))],
          [createLevelDB(path.join(datadir, 'nodes')), createRocksDB(path.join(datadir, 'nodes-rocks'))],
          [createLevelDB(path.join(datadir, 'evidence')), createRocksDB(path.join(datadir, 'evidence-rocks'))]
        ];
        logger.info('Migrate leveldb to rocksdb start');
        await batchMigrate(dbs);
        await closeDb(dbs);
        logger.info('Migrate leveldb to rocksdb done');
      } catch (err) {
        logger.error('Migrate error:', err);
        await closeDb(dbs);
        process.exit(1);
      }
    });
}

async function closeDb(dbs: [LevelUp, LevelUp][]) {
  await Promise.all(dbs.map((db) => db.map((d) => d.close())));
}
