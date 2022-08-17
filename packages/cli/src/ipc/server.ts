import util from 'util';
import ipc from 'node-ipc';
import { ApiServer } from '@rei-network/api';
import { api } from './controller';
import { logger } from '@rei-network/utils';

const defaultPort = 27777;
const defaultApis = 'admin,debug,eth,net,txpool,web3';

export const ipcId = 'rei-ipc';
export class IpcServer {
  apiServer: ApiServer;
  private readonly controllers: { [name: string]: any }[];

  constructor(apiServer: ApiServer, networkport?: number) {
    this.apiServer = apiServer;
    ipc.config.networkPort = networkport ?? defaultPort;
    this.controllers = defaultApis.split(',').map((name) => {
      if (!(name in api)) {
        throw new Error(`Unknown api ${name}`);
      }
      return new api[name](this.apiServer);
    });
  }

  send(socket: any, message: string) {
    ipc.server.emit(socket, 'message', message);
  }

  start() {
    ipc.config.id = ipcId;
    ipc.config.maxConnections = 1;
    ipc.serve(() => {
      ipc.server.on('connect', (data: string, socket: any) => {
        this.send(socket, data);
      });

      ipc.server.on('message', async (data: string, socket: any) => {
        const result = await this.handleReq(data);
        this.send(socket, JSON.stringify(result));
      });
    });

    ipc.server.start();
    logger.info(`IPC server started on port ${ipc.config.networkPort}`);
  }

  abort() {
    ipc.server.stop();
  }

  private async buildReq(msg: string) {
    const { method, params } = JSON.parse(msg);
  }

  private async handleReq(msg: string) {
    try {
      const startAt = Date.now();
      const { method, params } = JSON.parse(msg);
      const controller = this.controllers.find((c) => method in c);
      if (!controller) {
        throw new Error(`Unknown api ${method}`);
      }
      try {
        const result = await controller[method](params);
        return util.types.isPromise(result) ? await result : result;
      } catch (err) {}
    } catch (error) {
      console.log(error);
    }
  }
}
