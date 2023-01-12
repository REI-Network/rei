import fs from 'fs';
import { Command } from 'commander';
import { logger } from '@rei-network/utils';
import { BlsManager } from '@rei-network/bls';
import { getBlsPath, getPassphrase } from '../utils';

export function installBlsCommand(program: any) {
  const bls = new Command('bls').description('Manage bls signature key');
  program.addCommand(bls);

  bls
    .command('new')
    .description('New a bls signature key')
    .action(async () => {
      try {
        const passphrase = (await getPassphrase(program.opts(), { repeat: true, message: 'Your new bls secrect keyfile is locked with a password. Please give a password. Do not forget this password.' }))[0];
        const manager = new BlsManager(getBlsPath(program.opts()));
        const { publickey, path } = await manager.newSigner(passphrase);
        console.log('\nYour new key was generated\n');
        console.log('PublicKey :', publickey);
        console.log('Path of the secret key file:', path, '\n');
        console.log('- You can share your publickey with anyone. Others need it to interact with you.');
        console.log('- You must NEVER share the secret key with anyone! The key controls access to your block signature!');
        console.log("- You must BACKUP your key file! Without the key, it's impossible to access block signature!");
        console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
      } catch (err) {
        logger.error('Bls, new, error:', err);
      }
    });

  bls
    .command('update <fileName>')
    .description('Update the account')
    .action(async (fileName) => {
      try {
        const passphrase = (await getPassphrase(program.opts()))[0];
        const manager = new BlsManager(getBlsPath(program.opts()));
        const newPassphrase = (await getPassphrase(program.opts(), { repeat: true, message: 'Please give a new password. Do not forget this password.', forceInput: true }))[0];
        await manager.updateSigner(fileName, passphrase, newPassphrase);
      } catch (err) {
        logger.error('Bls, update, error:', err);
      }
    });

  bls
    .command('import <keyfile>')
    .description('Import a signer from secreckey file')
    .action(async (keyfile) => {
      try {
        const secrecKey = fs.readFileSync(keyfile).toString().trim();
        const manager = new BlsManager(getBlsPath(program.opts()));
        const passphrase = (await getPassphrase(program.opts(), { repeat: true, message: 'Your new bls key is locked with a password. Please give a password. Do not forget this password.' }))[0];
        const { publickey, path } = await manager.importSignerBySecretKey(secrecKey, passphrase);
        console.log('PublicKey :', publickey);
        console.log('Path of the secret key file:', path, '\n');
      } catch (err) {
        logger.error('Bls, import, error:', err);
      }
    });
}
