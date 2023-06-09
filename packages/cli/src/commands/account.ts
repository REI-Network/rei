import fs from 'fs';
import { Command } from 'commander';
import { bufferToHex, toChecksumAddress, Address } from 'ethereumjs-util';
import { AccountManager } from '@rei-network/wallet';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { getKeyStorePath, getPassphrase } from '../utils';

export function installAccountCommand(program: any) {
  const account = new Command('account').description('Manage accounts');
  program.addCommand(account);

  account
    .command('list')
    .description('List all the accounts')
    .action(() => {
      try {
        const manager = new AccountManager(getKeyStorePath(program.opts()));
        const accounts = manager.totalAccounts();
        for (let i = accounts.length - 1; i >= 0; i--) {
          console.log(`Account #${accounts.length - i - 1}: {${bufferToHex(accounts[i].addrBuf)}} keystore://${accounts[i].path}`);
        }
      } catch (err) {
        logger.error('Account, list, error:', err);
      }
    });

  account
    .command('new')
    .description('New a account')
    .action(async () => {
      try {
        const passphrase = (await getPassphrase(program.opts().password, { repeat: true, message: 'Your new account is locked with a password. Please give a password. Do not forget this password.' }))[0];
        const manager = new AccountManager(getKeyStorePath(program.opts()));
        const { address, path } = await manager.newAccount(passphrase);
        console.log('\nYour new key was generated\n');
        console.log('Public address of the key:', toChecksumAddress(address.toString()));
        console.log('Path of the secret key file:', path, '\n');
        console.log('- You can share your public address with anyone. Others need it to interact with you.');
        console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
        console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
        console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
      } catch (err) {
        logger.error('Account, new, error:', err);
      }
    });

  account
    .command('update <address>')
    .description('Update the account')
    .action(async (address) => {
      try {
        const passphrase = (await getPassphrase(program.opts().password, { addresses: [address] }))[0];
        const manager = new AccountManager(getKeyStorePath(program.opts()));
        const newPassphrase = (await getPassphrase(program.opts(), { repeat: true, message: 'Please give a new password. Do not forget this password.', forceInput: true }))[0];
        await manager.update(address, passphrase, newPassphrase);
      } catch (err) {
        logger.error('Account, update, error:', err);
      }
    });

  account
    .command('import <keyfile>')
    .description('Import a account from privatekey file')
    .action(async (keyfile) => {
      try {
        const privateKey = fs.readFileSync(keyfile).toString().trim();
        const manager = new AccountManager(getKeyStorePath(program.opts()));
        const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
        if (manager.hasAccount(address)) {
          throw new Error('Could not create the account: account alreaady exists');
        }
        const passphrase = (await getPassphrase(program.opts().password, { repeat: true, message: 'Your new account is locked with a password. Please give a password. Do not forget this password.' }))[0];
        console.log(`Address: ${toChecksumAddress(await manager.importKeyByPrivateKey(privateKey, passphrase))}`);
      } catch (err) {
        logger.error('Account, import, error:', err);
      }
    });
}
