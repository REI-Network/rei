import util from 'util';
import path from 'path';
import ipc from 'node-ipc';
import { ApiServer } from '@rei-network/api';
import { hexStringToBN, logger } from '@rei-network/utils';
import { ipcId, ipcAppspace } from './constants';

export class IpcServer {
  private readonly controllers: Map<string, any>;

  constructor(apiServer: ApiServer, datadir: string) {
    this.controllers = apiServer.controllers;
    ipc.config.id = ipcId;
    ipc.config.maxConnections = 1;
    ipc.config.socketRoot = path.join(datadir, '/');
    ipc.config.appspace = ipcAppspace;
    ipc.config.silent = true;
  }

  /**
   * Start ipc server
   * @returns
   */
  start() {
    return new Promise<void>((resolve) => {
      ipc.serve(() => {
        ipc.server.on('connect', async (socket) => {
          logger.info('IPC client connected', socket.server._pipeName);
          const ethController = this.controllers.get('eth')!;
          const coinbase = ethController.coinbase();
          const block = await ethController.getBlockByNumber(['latest', true]);
          const time = new Date(hexStringToBN(block?.timestamp!).toNumber() * 1000).toUTCString();
          const protocolVersion = ethController.protocolVersion();
          ipc.server.emit(
            socket,
            'load',
            `Welcome to the Rei Javascript console!

coinbase: ${coinbase}
at block: ${hexStringToBN(block?.number!)}  (time is:  ${time})
protocol version is: ${protocolVersion}

To exit, press ctrl-d or type .exit
`
          );
        });

        ipc.server.on('message', async (data: string, socket: any) => {
          try {
            const { method, params } = JSON.parse(data);
            const controller = Array.from(this.controllers.values()).find((c) => method in c);
            if (!controller) {
              throw new Error(`Unknown method ${method}`);
            }
            let result = controller[method](params);
            result = util.types.isPromise(result) ? await result : result;
            ipc.server.emit(socket, 'message', JSON.stringify(result));
          } catch (err: any) {
            logger.debug('IpcServer::onMessage, catch error:', err);
            ipc.server.emit(socket, 'errorMessage', err.message);
          }
        });
        resolve();
      });

      ipc.server.start();
      logger.info(`IPC server started on path ${ipc.config.socketRoot + ipc.config.appspace + ipc.config.id}`);
    });
  }

  /**
   * Stop ipc server
   */
  abort() {
    ipc.server.stop();
  }
}
