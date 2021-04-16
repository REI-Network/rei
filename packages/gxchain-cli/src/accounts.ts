// import { Transaction } from '@ethereumjs/tx';
// import { Address, bufferToHex, BN } from 'ethereumjs-util';

// type URL = {
//   Scheme: string;
//   Path: string;
// };

// type Account = {
//   address: Address;
//   url: URL;
// };
// export interface Wallet {
//   url();

//   status(): string;

//   Open(passphrase: string);

//   close();

//   accounts(): Account[];

//   contain(account: Account): boolean;

//   derive(path: Buffer, pin: boolean): Account;

//   selfDerive(base: Buffer[]); //todo anther  parameter

//   signData(account: Account, mimeType: string, data: Buffer): Buffer;

//   signDataWithPassphrase(account: Account, passphrase, mimeType: string, data: Buffer): Buffer;

//   signText(account: Account, text: Buffer): Buffer;

//   signTextWithPassphrase(account: Account, passphrase: string, text: Buffer): Buffer;

//   signTx(account: Account, tx: Transaction, chainID: number): Transaction;

//   signTxWithPassphrase(account: Account, passphrase: string, tx: Transaction, chainID: number): Transaction;
// }

// export type Backend = {
//   wallets(): Wallet[];
//   subscribe();
// };
