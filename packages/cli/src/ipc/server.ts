import util from 'util';
import ipc from 'node-ipc';
import { ApiServer } from '@rei-network/api';
import { api } from './controller';
import { hexStringToBN, logger } from '@rei-network/utils';

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
      ipc.server.on('connect', async (socket) => {
        logger.info('📦 Client connected', socket.server._pipeName);
        const coinbase = this.apiServer.coinbase();
        const block = await this.apiServer.getBlockByNumber('latest', true);
        const time = new Date(hexStringToBN(block?.timestamp!).toNumber() * 1000).toUTCString();
        const protocolVersion = this.apiServer.protocolVersion();
        ipc.server.emit(socket, 'load', 'Welcome to the Rei Javascript console!' + '\n' + '\n' + `coinbase: ${coinbase}` + '\n' + `at block: ${hexStringToBN(block?.number!)}  (time is:  ${time})` + '\n' + `protocol Version is : ${protocolVersion}` + '\n' + '\n' + 'To exit, press ctrl-d or type .exit');
      });

      ipc.server.on('message', async (data: string, socket: any) => {
        try {
          const result = await this.handleReq(data);
          this.send(socket, JSON.stringify(result));
        } catch (err: any) {
          logger.info(err);
          ipc.server.emit(socket, 'error', JSON.stringify(err.message));
        }
      });
    });

    ipc.server.start();
    logger.info(`IPC server started on port ${ipc.config.networkPort}`);
  }

  abort() {
    ipc.server.stop();
  }

  private async handleReq(msg: string) {
    const { method, params } = JSON.parse(msg);
    const controller = this.controllers.find((c) => method in c);
    if (!controller) {
      throw new Error(`Unknown api ${method}`);
    }
    const result = await controller[method](params);
    return util.types.isPromise(result) ? await result : result;
  }
}
