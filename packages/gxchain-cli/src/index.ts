import process from 'process';
import fs from 'fs';
import { program } from 'commander';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';

program.version('0.0.1');
program.option('--rpc', 'open rpc server');
program.option('--rpc-port <port>', 'rpc server port', '12358');
program.option('--rpc-host <port>', 'rpc server host', '::1');
program.option('--p2p-port <port>', 'p2p server port', '0');
program.option('--bootnodes <bootnodes...>', 'bootnodes list');
program.option('--datadir <path>', 'chain data dir path', './gxchain2');
program.option('--mine', 'mine block');

program
  .command('start')
  .description('start gxchain2')
  .action((options) => start());

program
  .command('attach')
  .description('attach to gxchain2 node')
  .action((options) => {});
program.parse(process.argv);

async function start() {
  try {
    const opts = program.opts();
    if (!fs.existsSync(opts.datadir)) {
      fs.mkdirSync(opts.datadir);
    }
    const node = new Node(opts.datadir);
    await node.init();
    if (opts.rpc) {
      const rpcSever = new RpcServer(Number(opts.rpcPort), opts.rpcHost, node).on('error', (err) => {
        console.error('RpcServer error', err);
        process.exit(1);
      });
      await rpcSever.start();
    }
  } catch (err) {
    console.error('Start error', err);
    process.exit(1);
  }
}
