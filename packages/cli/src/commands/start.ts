import fs from 'fs';
import process from 'process';
import { Node, NodeFactory } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { setLevel, logger } from '@rei-network/utils';
import { ApiServer } from '@rei-network/api';
import { IpcServer } from '@rei-network/ipc';
import { SIGINT } from '../process';
import { getPassphrase, getKeyStorePath } from './account';

/**
 * Start rei node
 * @param opts - Commander options
 * @returns node and rpc server instance
 */
export async function startNode(opts: { [option: string]: string }): Promise<[Node, ApiServer, IpcServer, RpcServer]> {
  // set logger verbosity
  setLevel(opts.verbosity);

  // create dir if it doesn't exist
  if (!fs.existsSync(opts.datadir)) {
    fs.mkdirSync(opts.datadir);
  }

  let addresses: string[] = [];
  let passphrase: string[] = [];
  if (opts.unlock) {
    addresses = (opts.unlock as string).split(',').map((address) => address.trim());
    passphrase = await getPassphrase(opts, { addresses });
  }
  const account = {
    keyStorePath: getKeyStorePath(opts),
    unlock: addresses.map((address, i): [string, string] => [address, passphrase[i]])
  };
  const network = {
    nat: opts.p2pNat,
    libp2pOptions: {
      tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
      udpPort: opts.p2pUdpPort ? Number(opts.p2pUdpPort) : undefined,
      maxPeers: opts.maxPeers ? Number(opts.maxPeers) : undefined,
      bootnodes: opts.bootnodes ? (opts.bootnodes as unknown as string[]) : undefined
    }
  };
  const mine = {
    enable: !!opts.mine,
    coinbase: opts.coinbase
  };

  // create node instance
  const node = await NodeFactory.createNode({
    databasePath: opts.datadir,
    chain: opts.chain,
    receiptsCacheSize: opts.receiptsCacheSize ? Number(opts.receiptsCacheSize) : undefined,
    mine,
    network,
    account
  });

  // create api server instance
  const apiServer = new ApiServer(node);
  apiServer.start();

  const rpc = {
    apiServer,
    port: opts.rpcPort ? Number(opts.rpcPort) : undefined,
    host: opts.rpcHost ? opts.rpcHost : undefined,
    apis: opts.rpcApi ? opts.rpcApi : undefined
  };
  // create rpc server instance
  const rpcServer = new RpcServer(rpc);
  if (opts.rpc) {
    await rpcServer.start();
  }
  apiServer.setRpcServer(rpcServer);

  // create ipc server instance
  const ipcServer = new IpcServer(apiServer, opts.datadir);
  await ipcServer.start();

  // handle signal
  SIGINT(node, apiServer, ipcServer, rpcServer);
  return [node, apiServer, ipcServer, rpcServer];
}

export function installStartAction(program: any) {
  program.action(async () => {
    try {
      await startNode(program.opts());
    } catch (err) {
      logger.error('Start error:', err);
      process.exit(1);
    }
  });
}
