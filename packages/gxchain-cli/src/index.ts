#!/usr/bin/env node

import process from 'process';
import fs from 'fs';
import commander, { program } from 'commander';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { setLevel, logger } from '@gxchain2/utils';
import * as accountcmd from './accountcmd';
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

account
  .description('Manage accounts')
  .command('list')
  .description('List all the accounts')
  .action((options) => {
    accountcmd.accountList();
  });

account
  .command('new')
  .description('New a account')
  .option('--passwordfile <string>')
  .action((options) => {
    const password = fs.readFileSync(options.passwordfile);
    accountcmd.accountCreate(password.toString());
  });

account
  .command('update')
  .description('Update the account')
  .option('--address <string>')
  .action((options) => {
    if (!options.opts().address) {
      console.error('You must input a address');
    }
    inquirer
      .prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Password:'
        }
      ])
      .then((answner1) => {
        const a = accountcmd.accountUnlock(options.opts().address, answner1.password);
        if (!a) {
          console.error('No account or key is not match');
          return;
        }
        console.log('Please give a new password. Do not forget this password.');
        inquirer
          .prompt([
            {
              type: 'password',
              name: 'newpassword',
              message: 'NewPassword:'
            }
          ])
          .then((answner2) => {
            inquirer
              .prompt([
                {
                  type: 'password',
                  name: 'repassword',
                  message: 'Repeat password:'
                }
              ])
              .then((answner3) => {
                if (answner2.newpassword !== answner3.repassword) {
                  console.log('You must input the same password!');
                  return;
                }
                accountcmd.accountUpdate(a, answner1.password, answner2.newpassword);
              });
          });
      });
  });

account
  .command('import <keydir>')
  .description('Import a account from privatekey file')
  .action(async (keydir) => {
    const key = fs.readFileSync(keydir);
    if (accountcmd.hasAddress(key.toString())) {
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
        const a = accountcmd.accoumtImport(key.toString(), answer1.password);
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
      const a = accountcmd.accoumtImport(key.toString(), answer1.password);
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
