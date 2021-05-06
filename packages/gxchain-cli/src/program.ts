import { program } from 'commander';

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

export default program;
