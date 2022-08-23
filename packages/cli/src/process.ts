import process from 'process';
import { Node } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { logger } from '@rei-network/utils';
import { ApiServer } from '@rei-network/api';
import { IpcServer } from '@rei-network/ipc';

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection:', err);
});

let SIGINTLock = false;

export function SIGINT(node: Node, apiServer: ApiServer, ipcServer: IpcServer, rpcServer: RpcServer) {
  process.on('SIGINT', async () => {
    if (!SIGINTLock) {
      try {
        SIGINTLock = true;
        logger.info('SIGINT, graceful exit');
        setTimeout(() => {
          logger.error('SIGINT, timeout');
          process.exit(1);
        }, 3000);
        await Promise.all([node.abort(), apiServer.abort(), ipcServer.abort(), rpcServer.abort()]);
        logger.info('SIGINT, abort finished');
        process.exit(0);
      } catch (err) {
        logger.error('SIGINT, catch error:', err);
        process.exit(1);
      }
    } else {
      logger.warn('Please wait for graceful exit, or you can kill this process');
    }
  });
}
