# @gxchain2/wallet
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/wallet)](https://www.npmjs.org/package/@gxchain2/wallet)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/wallet)](https://packagephobia.now.sh/result?p=@gxchain2/wallet)
![License](https://img.shields.io/npm/l/@gxchain2/wallet)

<font size= 3>
Wallet based on `ethereumjs-wallet`, for managing accounts.
</font>

## INSTALL

```sh
npm install @gxchain2/wallet
```
## STURCTURE
```ts
/**
 * AccountManager is an overarching manager that contain all
 * accounts' information
 */
export declare class AccountManager {
    private storage;
    private cache;
    private unlocked;
    constructor(keydir: string);
    /**
     * Loads and decrypts the key from disk.
     * @param addr Address
     * @param passphrase Decryption password
     * @returns The private key
     */
    private getDecryptedKey;
    /**
     * Get all accounts in cache
     * @returns Array of accounts
     */
    totalAccounts(): import("./accountcache").AccountInfo[];
    /**
     * Determine whether the account exists in cache
     * @param addr Address
     * @returns `true` if exists
     */
    hasAccount(addr: AddrType): boolean;
    /**
     * Get all unlocked accounts in cache
     * @returns The unlocked accounts array
     */
    totalUnlockedAccounts(): Buffer[];
    /**
     * Determine whether the unlocked account exists in cache
     * @param addr unlocked account address
     * @returns `true` if exists
     */
    hasUnlockedAccount(addr: AddrType): boolean;
    /**
     * Get privatekey from the unlocked map
     * @param addr Account address
     */
    getPrivateKey(addr: AddrType): Buffer;
    /**
     * Lock account and delete the account from the map
     * @param addr Account address
     */
    lock(addr: AddrType): void;
    /**
     * Unlock account, add account information to the map
     * @param addr Account address
     * @param passphrase Decryption password
     * @returns `true` if sucessfully unlock
     */
    unlock(addr: AddrType, passphrase: string): Promise<boolean>;
    /**
     * ImportKey stores the given account into the key directory and
     * add into the cache
     * @param path The storage path
     * @param passphrase Decryption password
     * @returns account address
     */
    importKey(path: string, passphrase: string): Promise<string>;
    /**
     * Import account by privateKey, store it in disk and add it into
     * cache
     * @param privateKey
     * @param passphrase Encryption password
     * @returns Account address
     */
    importKeyByPrivateKey(privateKey: string, passphrase: string): Promise<string>;
    /**
     * Update account Encryption password
     * @param addr  Account address
     * @param passphrase Old passphrase
     * @param newPassphrase New passphrase
     */
    update(addr: AddrType, passphrase: string, newPassphrase: string): Promise<void>;
    /**
     * Create a account, store it with encryption passphrase
     * @param passphrase Encryption password
     * @returns The account address and storage path
     */
    newAccount(passphrase: string): Promise<{
        address: string;
        path: string;
    }>;
}
```
## USAGE

```ts
const manager = new AccountManager(getKeyStorePath(program.opts()));

manager.newAccount("passphrase"); // new an account from passphrase

manager.update("0xAE0c03FdeDB61021272922F7804505CEE2C12c78", "passphrase", "newPassphrase"); // update account withnewPassphrase 

manager.hasAccount("0xAE0c03FdeDB61021272922F7804505CEE2C12c78"); //judge the accout is in the wallet

manager.importKeyByPrivateKey("privateKey", "passphrase");// import an account by privatekey

console.log(manager.totalAccounts()); // log all accounts in the account manger 
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)