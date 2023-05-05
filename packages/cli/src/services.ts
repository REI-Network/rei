import fs from 'fs';
import path from 'path';
import process from 'process';
import { Node, NodeFactory } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { setLevel, logger } from '@rei-network/utils';
import { ApiServer } from '@rei-network/api';
import { IpcServer } from '@rei-network/ipc';
import { getPassphrase, getKeyStorePath, getBlsPath, loadVersion } from './utils';

type Services = { node: Node; apiServer: ApiServer; rpcServer: RpcServer; ipcServer: IpcServer };

/**
 * Start services
 * @param opts - Commander options
 * @returns Services instance
 */
export async function startServices(opts: { [option: string]: string }): Promise<Services> {
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

  // create node instance
  const node = await NodeFactory.createNode({
    unlock: addresses.map((address, i): [string, string] => [address, passphrase[i]]),
    blsFileName: opts.blsFile,
    blsPassword: opts.blsPassword ? fs.readFileSync(path.isAbsolute(opts.blsPassword) ? opts.blsPassword : path.join(getBlsPath(opts), opts.blsPassword), 'utf-8').trim() : undefined,
    databasePath: opts.datadir,
    chain: opts.chain,
    receiptsCacheSize: opts.receiptsCacheSize ? Number(opts.receiptsCacheSize) : undefined,
    evmWorkMode: opts.evm,
    skipVerifySnap: opts.skipVerifySnap as unknown as boolean,
    coinbase: opts.coinbase,
    tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
    udpPort: opts.p2pUdpPort ? Number(opts.p2pUdpPort) : undefined,
    bootnodes: opts.bootnodes ? (opts.bootnodes as unknown as string[]) : undefined,
    keyStorePath: getKeyStorePath(opts),
    blsPath: getBlsPath(opts),
    syncMode: opts.sync,
    snapSyncMinTD: opts.snapMinTd ? Number(opts.snapMinTd) : undefined,
    trustedHeight: opts.snapTrustedHeight,
    trustedHash: opts.snapTrustedHeight
  });

  // create API server instance
  const apiServer = new ApiServer(node, loadVersion());

  // start API server
  apiServer.start();

  const rpc = {
    apiServer,
    port: opts.rpcPort ? Number(opts.rpcPort) : undefined,
    host: opts.rpcHost ? opts.rpcHost : undefined,
    apis: opts.rpcApi ? opts.rpcApi : undefined
  };
  // create RPC server instance
  const rpcServer = new RpcServer(rpc);
  if (opts.rpc) {
    // start RPC server if it is enabled
    await rpcServer.start();
  }

  apiServer.setRpcServer(rpcServer);

  // create IPC server instance
  const ipcServer = new IpcServer(apiServer, opts.datadir);

  // start IPC server
  await ipcServer.start();

  return { node, apiServer, ipcServer, rpcServer };
}

/**
 * Stop services
 * @param param0 - Services instance
 */
export async function stopServices({ node, apiServer, ipcServer, rpcServer }: Services) {
  try {
    logger.info('exit...');
    setTimeout(() => {
      logger.warn('exit timeout');
      process.exit(1);
    }, 30000);
    await Promise.all([node.abort(), apiServer.abort(), ipcServer.abort(), rpcServer.abort()]);
    logger.info('exit complete');
    process.exit(0);
  } catch (err) {
    logger.error('catch error when exit:', err);
    process.exit(1);
  }
}
