import { BN } from 'ethereumjs-util';
import { ec as EC } from 'elliptic';
import { hexStringToBN } from '@rei-network/utils';
import { Transaction } from '@rei-network/structure';
import { StateManager } from '../stateManager';
import { isEnableFreeStaking } from '../hardforks';

export async function validateTx(
  tx: Transaction,
  timestamp: number,
  state: StateManager,
  totalAmount?: BN,
  dailyFee?: BN
) {
  const senderAddr = tx.getSenderAddress();
  const account = await state.getAccount(senderAddr);

  const publicKey = tx.getSenderPublicKey();
  const publicKeyHex = publicKey.toString('hex');
  const ec = new EC('secp256k1');
  const key = ec.keyFromPublic('04' + publicKeyHex, 'hex'); //Add "04" to form the complete uncompressed public key
  if (!ec.curve.validate(key.getPublic())) {
    throw new Error(
      `public key is not on secp256k1 curve , public key : ${tx
        .getSenderPublicKey()
        .toString('hex')}`
    );
  }

  if (account.nonce.gt(tx.nonce)) {
    throw new Error(
      `nonce too low: ${tx.nonce.toString()} account: ${account.nonce.toString()}`
    );
  }
  if (account.balance.lt(tx.value)) {
    throw new Error(
      `sender doesn't have enough funds to send tx. The msg.value is: ${tx.value.toString()} and the sender's account only has: ${account.balance.toString()}`
    );
  }

  let availableFee: BN | undefined;

  if (isEnableFreeStaking(tx.common)) {
    // make sure totalAmount exists
    if (totalAmount === undefined) {
      throw new Error('missing total amount');
    }

    // load daily fee from common instance
    if (dailyFee === undefined) {
      const strDailyFee = tx.common.param('vm', 'dailyFee');
      if (typeof strDailyFee !== 'string') {
        throw new Error('missing param, dailyFee');
      }
      dailyFee = hexStringToBN(strDailyFee);
    }

    // estimate available fee
    const stakeInfo = account.getStakeInfo();
    availableFee = stakeInfo.estimateFee(timestamp, totalAmount, dailyFee);

    // compare max and cost
    const max = account.balance.add(availableFee);
    const cost = tx.getUpfrontCost();
    if (max.lt(cost)) {
      throw new Error(
        `sender doesn't have enough funds to send tx. The upfront cost is: ${cost.toString()} and the sender's account only has: ${max.toString()}`
      );
    }
  } else {
    if (account.balance.lt(tx.getUpfrontCost())) {
      throw new Error(
        `balance is not enough: ${tx
          .getUpfrontCost()
          .toString()} account: ${account.balance.toString()}`
      );
    }
  }

  return {
    fee: availableFee,
    balance: account.balance
  };
}
