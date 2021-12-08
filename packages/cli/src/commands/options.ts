import os from 'os';
import fs from 'fs';
import path from 'path';

export function installOptions(program: any) {
  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json')).toString()).version;
    version = version ?? 'unknown';
  } catch (err) {}
  program.version(version);
  program.option('--rpc', 'open rpc server');
  program.option('--rpc-port <port>', 'rpc server port');
  program.option('--rpc-host <port>', 'rpc server host');
  program.option('--rpc-api <apis>', 'rpc server apis: debug, eth, net, txpool, web3');
  program.option('--disable-p2p', 'disable p2p server');
  program.option('--p2p-tcp-port <port>', 'p2p server tcp port');
  program.option('--p2p-udp-port <port>', 'p2p server udp port');
  program.option('--p2p-nat <ip>', 'p2p server nat ip');
  program.option('--max-peers <peers>', 'max p2p peers count');
  program.option('--max-dials <dials>', 'max p2p dials count');
  program.option('--bootnodes <bootnodes...>', 'comma separated list of bootnodes');
  program.option('--datadir <path>', 'chain data dir path', path.join(os.homedir(), '.rei'));
  program.option('--keystore <keystore>', 'the datadir for keystore', 'keystore');
  program.option('--unlock <unlock>', 'comma separated list of accounts to unlock');
  program.option('--password <password>', 'password file to use for non-interactive password input');
  program.option('--chain <chain>', 'chain name: rei-mainnet, rei-testnet, rei-devnet');
  program.option('--mine', 'mine block');
  program.option('--coinbase <address>', 'miner address');
  program.option('--verbosity <verbosity>', 'logging verbosity: silent, error, warn, info, debug, detail', 'info');
}
