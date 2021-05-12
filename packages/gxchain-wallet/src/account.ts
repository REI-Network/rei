const Accounts = require('web3-eth-accounts');
const web3accounts = new Accounts();

export function decrypt(keyjson: JSON, auth: string) {
  return web3accounts.decrypt(keyjson, auth);
}

export function encrypt(key: string, auth: string) {
  return web3accounts.encrypt(key, auth);
}

export function create() {
  return web3accounts.create();
}

export function privateKeyToAccount(key: string) {
  return web3accounts.privateKeyToAccount(key);
}

export function sign(hash: string, auth: string) {
  return web3accounts.sign(hash, auth);
}
