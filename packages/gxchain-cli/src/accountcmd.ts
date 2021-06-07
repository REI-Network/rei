import { AccountManager } from '@gxchain2/wallet';
import { hexStringToBuffer } from '@gxchain2/utils';
import { Address, toChecksumAddress, bufferToHex } from 'ethereumjs-util';

export function create(manager: AccountManager, password: string) {
  const { address, path } = manager.newAccount(password);
  console.log('Your new key was generated');
  console.log('Public address of the key :', toChecksumAddress(address.toString()));
  console.log('Path of the secret key file:', path);
  console.log('- You can share your public address with anyone. Others need it to interact with you.');
  console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
  console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
  console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
}

export function update(manager: AccountManager, address: string, passphrase: string, newPassphrase: string) {
  manager.update(address, passphrase, newPassphrase);
}

export function list(manager: AccountManager) {
  const accounts = manager.totalAccounts();
  for (let i = accounts.length - 1; i >= 0; i--) {
    console.log('Account #', accounts.length - i - 1, ': {', bufferToHex(accounts[i].addrBuf), '}', ':', accounts[i].path);
  }
}

export function unlock(manager: AccountManager, address: string, passphrase: string) {
  if (manager.unlock(address, passphrase)) {
    console.log('Unlocked account', toChecksumAddress(address));
  }
}

export function importByPrivateKey(manager: AccountManager, privateKey: string, passphrase: string) {
  const address = manager.importKeyByPrivateKey(privateKey, passphrase);
  return toChecksumAddress(address);
}

export function has(manager: AccountManager, privateKey: string) {
  const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
  return manager.hasAccount(address);
}
