#!/usr/bin/env node

import process from 'process';
import fs from 'fs';
import { program } from 'commander';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { setLevel, logger } from '@gxchain2/utils';

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection:', err);
});

program.version('0.0.1');
program.option('--rpc', 'open rpc server');
program.option('--rpc-port <port>', 'rpc server port', '12358');
program.option('--rpc-host <port>', 'rpc server host', '127.0.0.1');
program.option('--p2p-tcp-port <port>', 'p2p server tcp port', '0');
program.option('--p2p-ws-port <port>', 'p2p server websocket port', '0');
program.option('--bootnodes <bootnodes...>', 'bootnodes list');
program.option('--datadir <path>', 'chain data dir path', './gxchain2');
program.option('--mine', 'mine block');
program.option('--coinbase <address>', 'miner address');
program.option('--mine-interval <interval>', 'mine interval', '5000');
program.option('--block-gas-limit <gas>', 'block gas limit', '0xbe5c8b');
program.option('--verbosity <verbosity>', 'logging verbosity: silent, error, warn, info, debug, detail', 'info');

program
  .command('start')
  .description('start gxchain2')
  .action((options) => start());

program
  .command('attach')
  .description('attach to gxchain2 node')
  .action((options) => {});
program.parse(process.argv);

function SIGINT(node: Node) {
  let SIGINTLock = false;
  process.on('SIGINT', () => {
    if (!SIGINTLock) {
      logger.info('SIGINT, graceful exit');
      SIGINTLock = true;
      node.abort().then(
        () => {
          logger.info('SIGINT, abort finished');
          process.exit(0);
        },
        (err) => {
          logger.error('SIGINT, catch error:', err);
          process.exit(1);
        }
      );
    } else {
      logger.warn('Please wait for graceful exit, or you can kill this process');
    }
  });
}

async function start() {
  try {
    const opts = program.opts();
    if (!fs.existsSync(opts.datadir)) {
      fs.mkdirSync(opts.datadir);
    }

    setLevel(opts.verbosity);
    const p2pOptions = {
      tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
      wsPort: opts.p2pWsPort ? Number(opts.p2pWsPort) : undefined,
      bootnodes: Array.isArray(opts.bootnodes) ? opts.bootnodes : undefined
    };
    const mineOptions = opts.mine
      ? {
          coinbase: opts.coinbase,
          mineInterval: Number(opts.mineInterval),
          gasLimit: opts.blockGasLimit
        }
      : undefined;
    const node = new Node({
      databasePath: opts.datadir,
      mine: mineOptions,
      p2p: p2pOptions
    });

    await node.init();
    SIGINT(node);
    if (opts.rpc) {
      const rpcServer = new RpcServer(Number(opts.rpcPort), opts.rpcHost, node).on('error', (err) => {
        logger.error('RpcServer error:', err);
      });
      if (!(await rpcServer.start())) {
        logger.error('RpcServer start failed, exit!');
        process.exit(1);
      }
    }
  } catch (err) {
    logger.error('Start error:', err);
    process.exit(1);
  }
}
