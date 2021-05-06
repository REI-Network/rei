import process from 'process';
import { Node } from '@gxchain2/core';
import { logger } from '@gxchain2/utils';

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection:', err);
});

export function SIGINT(node: Node) {
  let SIGINTLock = false;
  process.on('SIGINT', () => {
    if (!SIGINTLock) {
      logger.info('SIGINT, graceful exit');
      SIGINTLock = true;
      node.abort().then(
        () => {
          logger.info('SIGINT, abort finished');
          process.exit(0);
        },
        (err) => {
          logger.error('SIGINT, catch error:', err);
          process.exit(1);
        }
      );
    } else {
      logger.warn('Please wait for graceful exit, or you can kill this process');
    }
  });
}
