import { BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';

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

  static fromStakeInfoData(data?: StakeInfoData) {
    return new StakeInfo(data?.total ?? new BN(0), data?.usage ?? new BN(0), data?.timestamp ?? 0);
  }

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

  raw() {
    return [bnToUnpaddedBuffer(this.total), bnToUnpaddedBuffer(this.usage), intToBuffer(this.timestamp)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  estimateFee(timestamp: number, totalAmount: BN, dailyFee: BN) {
    const usage = this.estimateUsage(timestamp);
    const fee = this.estimateTotalFee(totalAmount, dailyFee);
    if (fee.gt(usage)) {
      return fee.sub(usage);
    } else {
      return new BN(0);
    }
  }

  estimateTotalFee(totalAmount: BN, dailyFee: BN) {
    return totalAmount.isZero() ? new BN(0) : this.total.mul(dailyFee).div(totalAmount);
  }

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

  consume(amount: BN, timestamp: number) {
    this.usage = this.estimateUsage(timestamp).add(amount);
    this.timestamp = timestamp;
  }

  deposit(amount: BN) {
    this.total.iadd(amount);
  }

  withdraw(amount: BN) {
    if (this.total.lt(amount)) {
      throw new Error('invalid withdraw');
    }

    this.total.isub(amount);
  }

  isEmpty() {
    return this.total.isZero();
  }
}
