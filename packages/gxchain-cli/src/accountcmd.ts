import { KeyStorePassphrase } from './passphrase';
import { KeyStore } from './keystore';

const utils = require('web3-utils');
const ks = new KeyStorePassphrase('/Users/bijianing/Desktop/test');
const store = new KeyStore('/Users/bijianing/Desktop/test', ks);

export function accountCreate(password: string) {
  const account = store.newaccount(password);
  console.log('Your new key was generated');
  console.log('Public address of the key :', utils.toChecksumAddress(account.address.toString()));
  console.log('Path of the secret key file:', account.url.Path);
  console.log('- You can share your public address with anyone. Others need it to interact with you.');
  console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
  console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
  console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
}

//export function accountUpdate(oldpassword: string, newpassword) {}
