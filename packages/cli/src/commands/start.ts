import fs from 'fs';
import process from 'process';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { setLevel, logger } from '@gxchain2/utils';
import { SIGINT } from '../process';
import { getPassphrase, getKeyStorePath } from './account';

/**
 * Start gxchain2.0 node
 * @param opts - Commander options
 * @returns node and rpc server instance
 */
export async function startNode(opts: { [option: string]: string }): Promise<[Node, undefined | RpcServer]> {
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
  const p2p = {
    enable: !opts.disableP2p,
    tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
    udpPort: opts.p2pUdpPort ? Number(opts.p2pUdpPort) : undefined,
    bootnodes: opts.bootnodes ? ((opts.bootnodes as unknown) as string[]) : undefined,
    nat: opts.p2pNat,
    maxPeers: opts.maxPeers ? Number(opts.maxPeers) : undefined,
    maxConnections: opts.maxConnections ? Number(opts.maxConnections) : undefined,
    maxDials: opts.maxDials ? Number(opts.maxDials) : undefined
  };
  const mine = {
    enable: !!opts.mine,
    coinbase: opts.coinbase
  };
  const node = new Node({
    databasePath: opts.datadir,
    chain: opts.chain,
    mine,
    p2p,
    account
  });
  await node.init();
  SIGINT(node);
  let server: undefined | RpcServer;
  if (opts.rpc) {
    const rpc = {
      node,
      port: opts.rpcPort ? Number(opts.rpcPort) : undefined,
      host: opts.rpcHost ? opts.rpcHost : undefined,
      apis: opts.rpcApi ? opts.rpcApi : undefined
    };
    server = new RpcServer(rpc);
    await server.start();
  }
  return [node, server];
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
