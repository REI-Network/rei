#!/usr/bin/env node

import os from 'os';
import path from 'path';
import process from 'process';
import { program } from 'commander';
import { loadVersion } from './utils';
import { installStartAction, installAccountCommand, installAttachCommand, installConsoleCommand, installBlsCommand } from './commands';

// set version
program.version(loadVersion());

// install options
program.option('--rpc', 'open rpc server');
program.option('--rpc-port <port>', 'rpc server port');
program.option('--rpc-host <port>', 'rpc server host');
program.option('--rpc-api <apis>', 'rpc server apis: debug, eth, net, txpool, web3, rei');
program.option('--p2p-tcp-port <port>', 'p2p server tcp port');
program.option('--p2p-udp-port <port>', 'p2p server udp port');
program.option('--p2p-nat <ip>', 'p2p server nat ip');
program.option('--max-peers <peers>', 'max p2p peers count');
program.option('--max-dials <dials>', 'max p2p dials count');
program.option('--bootnodes <bootnodes...>', 'comma separated list of bootnodes');
program.option('--sync <sync>', 'sync mode: full, snap', 'full');
program.option('--snap-trusted-height <trustedHeight>', 'snap sync trusted height.\nthis value and trustedHash are specified at the same time to take effect.\nsnap sync will start from the specified block to verify the legitimacy.\ne.g. 100');
program.option('--snap-trusted-hash <trustedHash>', 'snap sync trusted hash.\nthis value and trustedHeight are specified at the same time to take effect.\nsnap sync will start from the specified block to verify the legitimacy.\ne.g. 0x123...');
program.option('--snap-min-td <minTD>', 'minimum total difficulty difference for snap sync');
program.option('--skip-verify-snap', 'whether skip verifing snapshot');
program.option('--datadir <path>', 'chain data dir path', path.join(os.homedir(), '.rei'));
program.option('--keystore <keystore>', 'the datadir for keystore', 'keystore');
program.option('--unlock <unlock>', 'comma separated list of accounts to unlock');
program.option('--password <password>', 'password file to use for non-interactive password input');
program.option('--chain <chain>', 'chain name: rei-mainnet, rei-testnet, rei-devnet');
program.option('--mine', 'mine block');
program.option('--coinbase <address>', 'miner address');
program.option('--verbosity <verbosity>', 'logging verbosity: silent, error, warn, info, debug, detail', 'info');
program.option('--receipts-cache-size <receiptsCacheSize>', 'receipts cache size');
program.option('--evm <evm>', 'evm implementation type, "js" or "binding"');
program.option('--bls <bls>', 'the datadir for bls', 'bls');
program.option('--bls-password <blsPassword>', 'bls password file to use for non-interactive password input');
program.option('--bls-file <blsFile>', 'bls file name');
program.option('--txpool-rebroadcast <txpoolRebroadcast>', 'txpool pending tx is need to rebroadcast');

// install commands
installStartAction(program);
installAccountCommand(program);
installAttachCommand(program);
installConsoleCommand(program);
installBlsCommand(program);

// parse args
program.parse(process.argv);
