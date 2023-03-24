import fs from 'fs';
import process from 'process';
import { BN, toBuffer } from 'ethereumjs-util';
import { Node, NodeFactory } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { setLevel, logger } from '@rei-network/utils';
import { ApiServer } from '@rei-network/api';
import { IpcServer } from '@rei-network/ipc';
import { getPassphrase, getKeyStorePath, loadVersion } from './utils';

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
  // TODO:
  const sync = {
    mode: opts.sync,
    snapSyncMinTD: opts.snapMinTd ? Number(opts.snapMinTd) : undefined,
    trustedHeight: opts.snapTrustedHeight ? new BN(opts.snapTrustedHeight) : undefined,
    trustedHash: opts.snapTrustedHeight ? toBuffer(opts.snapTrustedHash) : undefined
  };

  // create node instance
  const node = await NodeFactory.createNode({
    databasePath: opts.datadir,
    chain: opts.chain,
    evm: opts.evm,
    skipVerifySnap: opts.skipVerifySnap as any,
    receiptsCacheSize: opts.receiptsCacheSize ? Number(opts.receiptsCacheSize) : undefined,
    sync,
    mine,
    network,
    account
  });

  // create api server instance
  const apiServer = new ApiServer(node, loadVersion());
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
