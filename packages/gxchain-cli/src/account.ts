import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { bufferToHex, toChecksumAddress, Address } from 'ethereumjs-util';
import { AccountManager } from '@gxchain2/wallet';
import { hexStringToBuffer, logger } from '@gxchain2/utils';
import inquirer from 'inquirer';

export function installAccountCommand(program: any) {
  function getKeyDataDir(keydatadir?: string) {
    return keydatadir ? keydatadir : path.join(program.opts().datadir, 'keystore');
  }

  const account = new Command('account').description('Manage accounts');
  program.addCommand(account);

  account
    .command('list')
    .description('List all the accounts')
    .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
    .action((options) => {
      try {
        const manager = new AccountManager(getKeyDataDir(options.keydatadir));
        const accounts = manager.totalAccounts();
        for (let i = accounts.length - 1; i >= 0; i--) {
          console.log('Account #', accounts.length - i - 1, ': {', bufferToHex(accounts[i].addrBuf), '}', ':', accounts[i].path);
        }
      } catch (err) {
        logger.error('Account, list, error:', err);
      }
    });

  account
    .command('new')
    .description('New a account')
    .option('--passwordfile <string>')
    .option('--keydatadir [string]', 'The datadir for keystore')
    .action(async (options) => {
      try {
        const passphrase = fs.readFileSync(options.passwordfile).toString();
        const manager = new AccountManager(getKeyDataDir(options.keydatadir));
        const { address, path } = await manager.newAccount(passphrase);
        console.log('Your new key was generated');
        console.log('Public address of the key :', toChecksumAddress(address.toString()));
        console.log('Path of the secret key file:', path);
        console.log('- You can share your public address with anyone. Others need it to interact with you.');
        console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
        console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
        console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
      } catch (err) {
        logger.error('Account, new, error:', err);
      }
    });

  account
    .command('update')
    .description('Update the account')
    .option('--address <string>')
    .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
    .action(async (options) => {
      try {
        const manager = new AccountManager(getKeyDataDir(options.keydatadir));
        const answer1 = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Password:'
          }
        ]);
        try {
          console.log('Please give a new password. Do not forget this password.');
          const answer2 = await inquirer.prompt([
            {
              type: 'password',
              name: 'newpassword',
              message: 'New password:'
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
          await manager.update(options.address, answer1.password, answer2.newpassword);
        } catch (err) {
          console.log('No account or key is not match!');
          return;
        }
      } catch (err) {
        logger.error('Account, update, error:', err);
      }
    });

  account
    .command('import <keydir>')
    .description('Import a account from privatekey file')
    .option('--keydatadir [string]', 'The datadir for keystore', 'keystore')
    .action(async (keydir, options) => {
      try {
        const privateKey = fs.readFileSync(keydir).toString();
        const manager = new AccountManager(getKeyDataDir(options.keydatadir));
        const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
        let update = !manager.hasAccount(address);
        if (!update) {
          const cover = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'cover',
              message: 'The account is existed, would you want to cover it?'
            }
          ]);
          update = cover.cover;
        }

        if (update) {
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
          console.log('Address : ', toChecksumAddress(await manager.importKeyByPrivateKey(privateKey, answer1.password)));
        }
      } catch (err) {
        logger.error('Account, import, error:', err);
      }
    });
}
