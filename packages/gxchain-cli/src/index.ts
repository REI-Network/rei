#!/usr/bin/env node

import process from 'process';
import fs from 'fs';
import path from 'path';
import commander, { option, program } from 'commander';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { setLevel, logger } from '@gxchain2/utils';
import { accountcmd } from '@gxchain2/wallet';
import inquirer from 'inquirer';

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
program.option('--verbosity <verbosity>', 'logging verbosity: silent, error, warn, info, debug, detail (default: info)', 'info');

program
  .command('start')
  .description('start gxchain2')
  .action((options) => start());

program
  .command('attach')
  .description('attach to gxchain2 node')
  .action((options) => {});

const account = new commander.Command('account');
program.addCommand(account);
const opts = program.opts();

account
  .description('Manage accounts')
  .command('list')
  .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
  .description('List all the accounts')
  .action((options) => {
    const keydatadir = options.keydatadir !== options.options[0].defaultValue ? options.keydatadir : path.join(opts.datadir, options.keydatadir);
    accountcmd.accountList(keydatadir);
  });

account
  .command('new')
  .description('New a account')
  .option('--passwordfile <string>')
  .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
  .action((options) => {
    const keydatadir = options.keydatadir !== options.options[1].defaultValue ? options.keydatadir : path.join(opts.datadir, options.keydatadir);
    const password = fs.readFileSync(options.passwordfile);
    accountcmd.accountCreate(keydatadir, password.toString());
  });

account
  .command('update')
  .description('Update the account')
  .option('--address <string>')
  .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
  .action(async (options) => {
    if (!options.opts().address) {
      console.error('You must input a address');
    }
    const keydatadir = options.keydatadir !== options.options[1].defaultValue ? options.keydatadir : path.join(opts.datadir, options.keydatadir);
    const answer1 = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Password:'
      }
    ]);

    const a = accountcmd.accountUnlock(keydatadir, options.opts().address, answer1.password);
    if (!a) {
      console.error('No account or key is not match');
      return;
    }
    console.log('Please give a new password. Do not forget this password.');
    const answer2 = await inquirer.prompt([
      {
        type: 'password',
        name: 'newpassword',
        message: 'NewPassword:'
      }
    ]);
    const answer3 = await inquirer.prompt([
      {
        type: 'password',
        name: 'repassword',
        message: 'Repeat password:'
      }
    ]);
    if (answer2.newpassword !== answer3.repassword) {
      console.log('You must input the same password!');
      return;
    }
    accountcmd.accountUpdate(keydatadir, a, answer1.password, answer2.newpassword);
  });

account
  .command('import <keydir>')
  .description('Import a account from privatekey file')
  .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
  .action(async (keydir, options) => {
    const key = fs.readFileSync(keydir);
    const keydatadir = options.keydatadir !== options.options[0].defaultValue ? options.keydatadir : path.join(opts.datadir, options.keydatadir);
    if (accountcmd.hasAddress(keydatadir, key.toString())) {
      const cover = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'cover',
          message: 'The account is existed, would you want to cover it?'
        }
      ]);

      if (cover.cover == true) {
        console.log('Your new account is locked with a password. Please give a password. Do not forget this password..');
        const answer1 = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Password:'
          }
        ]);
        const answer2 = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Repeat password:'
          }
        ]);

        if (answer1.password !== answer2.password) {
          console.log('You must input the same password!');
          return;
        }
        const a = accountcmd.accoumtImport(keydatadir, key.toString(), answer1.password);
        console.log('Address : ', a);
      }
    } else {
      console.log('Your new account is locked with a password. Please give a password. Do not forget this password..');
      const answer1 = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Password:'
        }
      ]);
      const answer2 = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Repeat password:'
        }
      ]);

      if (answer1.password !== answer2.password) {
        console.log('You must input the same password!');
        return;
      }
      const a = accountcmd.accoumtImport(keydatadir, key.toString(), answer1.password);
      console.log('Address : ', a);
    }
  });
program.parse(process.argv);

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
