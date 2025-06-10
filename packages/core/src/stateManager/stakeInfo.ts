import {
  BN,
  bnToUnpaddedBuffer,
  bufferToInt,
  intToBuffer,
  rlp
} from 'ethereumjs-util';

const recoverInterval = 86400;

export type StakeInfoData = {
  total?: BN;
  usage?: BN;
  timestamp?: number;
};

export type StakeInfoRaw = [Buffer, Buffer, Buffer];

export class StakeInfo {
  total: BN;
  usage: BN;
  timestamp: number;

  /**
   * Create stake info from data
   * @param data - {@link StakeInfoData}
   * @returns Stake info instance
   */
  static fromStakeInfoData(data?: StakeInfoData) {
    return new StakeInfo(
      data?.total ?? new BN(0),
      data?.usage ?? new BN(0),
      data?.timestamp ?? 0
    );
  }

  /**
   * Create stake info from values
   * @param values - Raw values
   * @returns Stake info instance
   */
  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 3) {
      throw new Error('invalid stake info length');
    }

    const [total, usage, timestamp] = values;
    return new StakeInfo(new BN(total), new BN(usage), bufferToInt(timestamp));
  }

  constructor(total: BN, usage: BN, timestamp: number) {
    this.total = total;
    this.usage = usage;
    this.timestamp = timestamp;
    this.validateBasic();
  }

  private validateBasic() {
    if (this.total.ltn(0)) {
      throw new Error('invalid total');
    }
    if (this.usage.ltn(0)) {
      throw new Error('invalid usage');
    }
    if (this.timestamp < 0) {
      throw new Error('invalid timestamp');
    }
  }

  /**
   * Convert stake info instance to raw buffer
   * @returns - Raw buffer
   */
  raw() {
    return [
      bnToUnpaddedBuffer(this.total),
      bnToUnpaddedBuffer(this.usage),
      intToBuffer(this.timestamp)
    ];
  }

  /**
   * Serialize stake info
   * @returns Serialized buffer
   */
  serialize() {
    return rlp.encode(this.raw());
  }

  /**
   * Estimate the available fee for this account
   * @param timestamp - The current timestamp
   * @param totalAmount - The current total amount in the fee contract
   * @param dailyFee - Daily fee amount
   * @returns The current available fee for this account
   */
  estimateFee(timestamp: number, totalAmount: BN, dailyFee: BN) {
    const usage = this.estimateUsage(timestamp);
    const fee = this.estimateTotalFee(totalAmount, dailyFee);
    if (fee.gt(usage)) {
      return fee.sub(usage);
    } else {
      return new BN(0);
    }
  }

  /**
   * Estimate the total fee for this account
   * The total fee of this account is calculated based on the proportion of the amount deposit by the user
   *
   *    totalFee = dailyFee * this.total / totalAmount
   *
   * @param totalAmount - The current total amount in the fee contract
   * @param dailyFee - Daily fee amount
   * @returns The total fee for this account(does not include used parts)
   */
  estimateTotalFee(totalAmount: BN, dailyFee: BN) {
    return totalAmount.isZero()
      ? new BN(0)
      : this.total.mul(dailyFee).div(totalAmount);
  }

  /**
   * Estimate the current usage for this account
   * The user's usage will decrease smoothly over time until it returns to 0 after 24 hours
   *
   *      T:          current timestamp(timestamp)
   *      T':         lastest timestamp(this.timestamp)
   *      userUsage:  current usage
   *      userUsage': lastest usage(this.usage)
   *
   *      if T - T' < recoverInterval
   *          userUsage = (1 - (T - T') / recoverInterval) * userUsage'
   *      else
   *          userUsage = 0
   *
   * @param timestamp - The current timestamp
   * @returns The current usage for this account
   */
  estimateUsage(timestamp: number) {
    if (timestamp <= this.timestamp) {
      return this.usage.clone();
    }

    const interval = timestamp - this.timestamp;
    if (this.usage.gtn(0) && interval < recoverInterval) {
      return this.usage.muln(recoverInterval - interval).divn(recoverInterval);
    } else {
      return new BN(0);
    }
  }

  /**
   * Consume user fee
   * @param amount - Consumed amount
   * @param timestamp - The current timestamp
   */
  consume(amount: BN, timestamp: number) {
    this.usage = this.estimateUsage(timestamp).add(amount);
    this.timestamp = timestamp;
  }

  /**
   * Deposit amount
   * @param amount - Amount
   */
  deposit(amount: BN) {
    this.total.iadd(amount);
  }

  /**
   * Withdraw amount
   * @param amount - Amount
   */
  withdraw(amount: BN) {
    if (this.total.lt(amount)) {
      throw new Error('invalid withdraw');
    }

    this.total.isub(amount);
  }

  /**
   * Check whether the stake info is empty,
   * if empty, it will not be saved in the state trie
   */
  isEmpty() {
    return this.total.isZero();
  }
}
