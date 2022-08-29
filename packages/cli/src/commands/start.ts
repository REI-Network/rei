import fs from 'fs';
import process from 'process';
import { BN, toBuffer, Address } from 'ethereumjs-util';
import { Node, NodeFactory } from '@rei-network/core';
import { RpcServer } from '@rei-network/rpc';
import { setLevel, logger } from '@rei-network/utils';
import { SIGINT } from '../process';
import { getPassphrase, getKeyStorePath } from './account';

function safeConvertToNumber(content: string) {
  const num = Number(content);
  if (Number.isNaN(num) || !Number.isInteger(num)) {
    throw new Error('convert to number failed: ' + content);
  }
  return num;
}

/**
 * Start rei node
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
  const network = {
    nat: opts.p2pNat,
    libp2pOptions: {
      tcpPort: opts.p2pTcpPort ? safeConvertToNumber(opts.p2pTcpPort) : undefined,
      udpPort: opts.p2pUdpPort ? safeConvertToNumber(opts.p2pUdpPort) : undefined,
      maxPeers: opts.maxPeers ? safeConvertToNumber(opts.maxPeers) : undefined,
      bootnodes: opts.bootnodes ? (opts.bootnodes as unknown as string[]) : undefined
    }
  };
  const mine = {
    enable: !!opts.mine,
    coinbase: opts.coinbase ? Address.fromString(opts.coinbase) : undefined
  };
  const sync = {
    mode: opts.sync,
    snapSyncMinTD: opts.snapMinTd ? safeConvertToNumber(opts.snapMinTd) : undefined,
    trustedHeight: opts.snapTrustedHeight ? new BN(opts.snapTrustedHeight) : undefined,
    trustedHash: opts.snapTrustedHeight ? toBuffer(opts.snapTrustedHash) : undefined
  };
  const node = await NodeFactory.createNode({
    databasePath: opts.datadir,
    chain: opts.chain,
    receiptsCacheSize: opts.receiptsCacheSize ? safeConvertToNumber(opts.receiptsCacheSize) : undefined,
    sync,
    mine,
    network,
    account
  });
  await node.init();
  node.start();
  let server: undefined | RpcServer;
  if (opts.rpc) {
    const rpc = {
      backend: node,
      port: opts.rpcPort ? safeConvertToNumber(opts.rpcPort) : undefined,
      host: opts.rpcHost ? opts.rpcHost : undefined,
      apis: opts.rpcApi ? opts.rpcApi : undefined
    };
    server = new RpcServer(rpc);
    await server.start();
  }
  SIGINT(node, server);
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
