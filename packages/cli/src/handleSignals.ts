import process from 'process';
import { logger } from '@rei-network/utils';

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection:', err);
});

let SIGINTLock = false;

export function handleSIGINT(onExit: () => Promise<void>) {
  process.on('SIGINT', async () => {
    if (!SIGINTLock) {
      SIGINTLock = true;
      await onExit();
    } else {
      logger.warn('Please wait for graceful exit, or you can kill this process');
    }
  });
}
