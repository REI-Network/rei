import fs from 'fs';
import process from 'process';
import { Node, NodeFactory } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { setLevel, logger } from '@rei-network/utils';
import { SIGINT } from '../process';
import { getPassphrase, getKeyStorePath } from './account';
import { ApiServer } from '@rei-network/api';
import { IpcServer } from '../ipc/server';

/**
 * Start rei node
 * @param opts - Commander options
 * @returns node and rpc server instance
 */
export async function startNode(opts: { [option: string]: string }): Promise<[Node, ApiServer, IpcServer, undefined | RpcServer]> {
  setLevel(opts.verbosity);
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
    enable: !opts.disableP2p,
    tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
    udpPort: opts.p2pUdpPort ? Number(opts.p2pUdpPort) : undefined,
    bootnodes: opts.bootnodes ? (opts.bootnodes as unknown as string[]) : undefined,
    nat: opts.p2pNat,
    maxPeers: opts.maxPeers ? Number(opts.maxPeers) : undefined,
    maxDials: opts.maxDials ? Number(opts.maxDials) : undefined
  };
  const mine = {
    enable: !!opts.mine,
    coinbase: opts.coinbase
  };
  const node = await NodeFactory.createNode({
    databasePath: opts.datadir,
    chain: opts.chain,
    receiptsCacheSize: opts.receiptsCacheSize ? Number(opts.receiptsCacheSize) : undefined,
    mine,
    network,
    account
  });
  const apiServer = new ApiServer(node);
  apiServer.start();
  let server: undefined | RpcServer;
  const ipcServer = new IpcServer(apiServer);
  console.log('star ipc server after');
  ipcServer.start();
  if (opts.rpc) {
    const rpc = {
      apiServer: apiServer,
      port: opts.rpcPort ? Number(opts.rpcPort) : undefined,
      host: opts.rpcHost ? opts.rpcHost : undefined,
      apis: opts.rpcApi ? opts.rpcApi : undefined
    };
    server = new RpcServer(rpc);
    await server.start();
  }
  SIGINT(node, apiServer, ipcServer, server);
  return [node, apiServer, ipcServer, server];
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
