import process from 'process';
import { program } from 'commander';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';

program.version('0.0.1');
program.option('--rpc', 'open rpc server').option('--rpc-port <port>', 'rpc server port', '12358').option('--rpc-host <port>', 'rpc server host', '[::1]').option('--p2p-port <port>', 'p2p server port', '0').option('--bootnodes <bootnodes...>', 'bootnodes list').option('--datadir <path>', 'chain data dir path', './');
program
  .command('start')
  .description('start gxchain2')
  .action((options) => start());

program
  .command('attach')
  .description('attach to gxchain2 node')
  .action((options) => {});
program.parse(process.argv);

const start = async () => {
  try {
    const opts = program.opts();
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
};
