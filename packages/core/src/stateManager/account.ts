import { Account, AccountData, BN, rlp, KECCAK256_RLP, KECCAK256_NULL, toBuffer, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { StakeInfo, StakeInfoData } from './stakeInfo';

export interface StakingAccountData extends AccountData {
  stakeInfo?: StakeInfoData;
}

export class StakingAccount extends Account {
  stakeInfo?: StakeInfo;

  static fromAccountData(accountData: StakingAccountData) {
    const { nonce, balance, stateRoot, codeHash, stakeInfo } = accountData;

    return new StakingAccount(nonce ? new BN(toBuffer(nonce)) : undefined, balance ? new BN(toBuffer(balance)) : undefined, stateRoot ? toBuffer(stateRoot) : undefined, codeHash ? toBuffer(codeHash) : undefined, stakeInfo ? StakeInfo.fromStakeInfoData(stakeInfo) : undefined);
  }

  public static fromRlpSerializedAccount(serialized: Buffer) {
    const values = rlp.decode(serialized);

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized account input. Must be array');
    }

    return StakingAccount.fromValuesArray(values);
  }

  public static fromValuesArray(values: Buffer[]) {
    const [nonce, balance, stateRoot, codeHash] = values;

    if (values.length === 4) {
      return new StakingAccount(new BN(nonce), new BN(balance), stateRoot, codeHash);
    } else {
      const stakeInfo = values[4] as unknown as Buffer[];
      return new StakingAccount(new BN(nonce), new BN(balance), stateRoot, codeHash, stakeInfo ? StakeInfo.fromValuesArray(stakeInfo) : undefined);
    }
  }

  public static fromRlpSerializedSlimAccount(serialized: Buffer) {
    const values = rlp.decode(serialized);

    if (!Array.isArray(values)) {
      throw new Error('Invalid slimSerialized account input. Must be array');
    }

    return StakingAccount.fromSlimValuesArray(values);
  }

  public static fromSlimValuesArray(values: Buffer[]) {
    let [nonce, balance, stateRoot, codeHash] = values;
    if (stateRoot.equals(Buffer.alloc(0))) {
      stateRoot = KECCAK256_RLP;
    }
    if (codeHash.equals(Buffer.alloc(0))) {
      codeHash = KECCAK256_NULL;
    }
    if (values.length === 4) {
      return new StakingAccount(new BN(nonce), new BN(balance), stateRoot, codeHash);
    } else {
      const stakeInfo = values[4] as unknown as Buffer[];
      return new StakingAccount(new BN(nonce), new BN(balance), stateRoot, codeHash, stakeInfo ? StakeInfo.fromValuesArray(stakeInfo) : undefined);
    }
  }
  /**
   * This constructor assigns and validates the values.
   * Use the static factory methods to assist in creating an Account from varying data types.
   */
  constructor(nonce = new BN(0), balance = new BN(0), stateRoot = KECCAK256_RLP, codeHash = KECCAK256_NULL, stakeInfo: StakeInfo | undefined = undefined) {
    super(nonce, balance, stateRoot, codeHash);
    this.stakeInfo = stakeInfo;
  }

  /**
   * Returns a Buffer Array of the raw Buffers for the account, in order.
   */
  raw(): Buffer[] {
    return this.stakeInfo && !this.stakeInfo.isEmpty() ? [bnToUnpaddedBuffer(this.nonce), bnToUnpaddedBuffer(this.balance), this.stateRoot, this.codeHash, this.stakeInfo.raw() as unknown as Buffer] : [bnToUnpaddedBuffer(this.nonce), bnToUnpaddedBuffer(this.balance), this.stateRoot, this.codeHash];
  }

  /**
   * Returns a `Boolean` determining if the account is empty complying to the definition of
   * account emptiness in [EIP-161](https://eips.ethereum.org/EIPS/eip-161):
   * "An account is considered empty when it has no code and zero nonce and zero balance."
   */
  isEmpty(): boolean {
    return this.balance.isZero() && this.nonce.isZero() && this.codeHash.equals(KECCAK256_NULL) && (this.stakeInfo === undefined || this.stakeInfo.isEmpty());
  }

  /**
   * Get stake info of account
   * (Create if it doesn't exist)
   * @returns Stake info
   */
  getStakeInfo() {
    return this.stakeInfo ?? (this.stakeInfo = StakeInfo.fromStakeInfoData());
  }

  /**
   * Returns a Buffer Array of the slim raw Buffers for the account, in order
   */
  slimRaw(): Buffer[] {
    const rawBuffer = [bnToUnpaddedBuffer(this.nonce), bnToUnpaddedBuffer(this.balance)];
    rawBuffer.push(this.stateRoot.equals(KECCAK256_RLP) ? Buffer.from([]) : this.stateRoot);
    rawBuffer.push(this.codeHash.equals(KECCAK256_NULL) ? Buffer.from([]) : this.codeHash);
    if (this.stakeInfo && !this.stakeInfo.isEmpty()) {
      rawBuffer.push(this.stakeInfo.raw() as unknown as Buffer);
    }
    return rawBuffer;
  }

  /**
   * Returns the RLP serialization of the slim account as a `Buffer`.
   */
  slimSerialize(): Buffer {
    return rlp.encode(this.slimRaw());
  }
}
