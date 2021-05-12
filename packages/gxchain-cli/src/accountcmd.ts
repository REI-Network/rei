import { AccountManger, keyFileName, encrypt, privateKeyToAccount } from '@gxchain2/wallet';
import { Address, toChecksumAddress } from 'ethereumjs-util';
import { Accountinfo } from '@gxchain2/wallet';

export function accountCreate(path: string, password: string) {
  const store = new AccountManger(path);
  const account = store.newaccount(password);
  console.log('Your new key was generated');
  console.log('Public address of the key :', toChecksumAddress(account.address.toString()));
  console.log('Path of the secret key file:', account.path);
  console.log('- You can share your public address with anyone. Others need it to interact with you.');
  console.log('- You must NEVER share the secret key with anyone! The key controls access to your funds!');
  console.log("- You must BACKUP your key file! Without the key, it's impossible to access account funds!");
  console.log("- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!");
}

export function accountUpdate(path: string, addr: Accountinfo, oldpassword: string, newpassword: string) {
  const store = new AccountManger(path);
  store.update(addr.address, oldpassword, newpassword);
}

export function accountList(path: string) {
  const store = new AccountManger(path);
  const accounts = store.cache.accounts();
  for (let i = accounts.length - 1; i >= 0; i--) {
    console.log('Account #', accounts.length - i - 1, ': {', accounts[i].address.toString(), '}', ':', accounts[i].path);
  }
}

export function accountUnlock(path: string, addr: string, password: string) {
  const store = new AccountManger(path);
  const accounts = store.cache.accounts();
  for (const a of accounts) {
    if (a.address.toString() === addr) {
      store.unlock(a.address, password);
      console.log('Unlocked account', toChecksumAddress(a.address.toString()));
      return a;
    }
  }
}

export function accoumtImport(path: string, privatekey: string, auth: string) {
  const store = new AccountManger(path);
  const keyjson = encrypt(privatekey, auth);
  const addr = Address.fromString('0x' + keyjson.address);
  const account: Accountinfo = { address: addr, path: store.storage.joinPath(keyFileName(addr)) };
  store.storage.storekey(account.path, { address: addr.toString(), privateKey: privatekey }, auth);
  return toChecksumAddress(account.address.toString());
}

export function hasAddress(path: string, privatekey: string) {
  const store = new AccountManger(path);
  const accounts = store.cache.accounts();
  const addr = privateKeyToAccount(privatekey).address;
  for (const a of accounts) {
    if (a.address.toString() === addr.toLowerCase()) {
      return true;
    }
  }
  return false;
}
