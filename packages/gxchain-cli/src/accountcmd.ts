import { AccountManager } from '@gxchain2/wallet';
import { hexStringToBuffer } from '@gxchain2/utils';
import { Address, toChecksumAddress, bufferToHex } from 'ethereumjs-util';

export function accountCreate(dirPath: string, password: string) {
  const store = new AccountManager(dirPath);
  const { address, path } = store.newAccount(password);
  console.log('Your new key was generated');
  console.log('Public address of the key :', toChecksumAddress(address.toString()));
  console.log('Path of the secret key file:', path);
  console.log('- You can share your public address with anyone. Others need it to interact with you.');
  console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
  console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
  console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
}

export function accountUpdate(dirPath: string, address: string, passphrase: string, newPassphrase: string) {
  const manager = new AccountManager(dirPath);
  manager.update(address, passphrase, newPassphrase);
}

export function accountList(path: string) {
  const manager = new AccountManager(path);
  const accounts = manager.totalAccounts();
  for (let i = accounts.length - 1; i >= 0; i--) {
    console.log('Account #', accounts.length - i - 1, ': {', bufferToHex(accounts[i].addrBuf), '}', ':', accounts[i].path);
  }
}

export function accountUnlock(manager: AccountManager, address: string, passphrase: string) {
  if (manager.unlock(address, passphrase)) {
    console.log('Unlocked account', toChecksumAddress(address));
  }
}

export function accoumtImport(path: string, privateKey: string, passphrase: string) {
  const manager = new AccountManager(path);
  const address = manager.importKeyByPrivateKey(privateKey, passphrase);
  return toChecksumAddress(address);
}

export function hasAddress(path: string, privateKey: string) {
  const manager = new AccountManager(path);
  const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
  return manager.hasAccount(address);
}
