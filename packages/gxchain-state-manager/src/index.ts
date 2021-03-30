import { DefaultStateManager } from '@ethereumjs/vm/dist/state';
import { keccak256, Address, KECCAK256_NULL } from 'ethereumjs-util';

/**
 * fix merkle-patricia-tree version bug.
 * if you want to get the lowlevel database object of the trie in `merkle-patricia-tree@4.0.0`, you should call `trie._maindb`,
 * but in `merkle-patricia-tree@4.1.0`, you should call `trie.db`.
 */
export class StateManager extends DefaultStateManager {
  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putContractCode(address: Address, value: Buffer): Promise<void> {
    const codeHash = keccak256(value);

    if (codeHash.equals(KECCAK256_NULL)) {
      return;
    }

    await this._trie.db.put(codeHash, value);

    const account = await this.getAccount(address);
    account.codeHash = codeHash;
    await this.putAccount(address, account);
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Buffer>} -  Resolves with the code corresponding to the provided address.
   * Returns an empty `Buffer` if the account has no associated code.
   */
  async getContractCode(address: Address): Promise<Buffer> {
    const account = await this.getAccount(address);
    if (!account.isContract()) {
      return Buffer.alloc(0);
    }
    const code = await this._trie.db.get(account.codeHash);
    return code || Buffer.alloc(0);
  }
}
