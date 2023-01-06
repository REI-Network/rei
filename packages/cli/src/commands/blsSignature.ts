import fs from 'fs';
import { Command } from 'commander';
import { bufferToHex, toChecksumAddress, Address } from 'ethereumjs-util';
import { getKeyStorePath, getPassphrase } from '../utils';
import { logger } from '@rei-network/utils';

export function installBlsSignatureCommand(program: any) {
  const bls = new Command('blsSignature').description('Manage accounts');
  program.addCommand(bls);

  bls
    .command('new')
    .description('New a bls signature key')
    .action(async () => {
      try {
        const passphrase = (await getPassphrase(program.opts(), { repeat: true, message: 'Your new bls Secrect keyfile is locked with a password. Please give a password. Do not forget this password.' }))[0];
        // const manager = new AccountManager(getKeyStorePath(program.opts()));
        // const { address, path } = await manager.newAccount(passphrase);
        // console.log('\nYour new key was generated\n');
        // console.log('Public address of the key :', toChecksumAddress(address.toString()));
        // console.log('Path of the secret key file:', path, '\n');
        // console.log('- You can share your public address with anyone. Others need it to interact with you.');
        // console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
        // console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
        // console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
      } catch (err) {
        logger.error('Account, new, error:', err);
      }
    });
}
