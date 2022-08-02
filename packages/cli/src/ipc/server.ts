import ipc from 'node-ipc';
import { ApiServer } from '@rei-network/api';

export const ipcId = 'rei-ipc';
export class IpcServer {
  apiServer: ApiServer;

  constructor(apiServer: ApiServer, networkport?: number) {
    this.apiServer = apiServer;
    ipc.config.networkPort = networkport || 24445;
  }

  send(socket: any, message: string) {
    ipc.server.emit('message', message);
  }

  start() {
    ipc.config.id = ipcId;
    ipc.config.maxConnections = 1;
    ipc.serve(() => {
      ipc.server.on('connect', (data: string, socket: any) => {
        this.send(socket, data);
      });

      ipc.server.on('message', (data: string, socket: any) => {
        this.send(socket, data);
      });
    });

    ipc.server.start();
  }

  abort() {
    ipc.server.stop();
  }
}
