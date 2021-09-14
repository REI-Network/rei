import { BN, Address } from 'ethereumjs-util';
import { Transaction } from '@gxchain2/structure';
import { Router } from '../contracts';

export async function validateTx(tx: Transaction, router: Router, sender: Address, timestamp: number, balance: BN) {
  if (balance.lt(tx.value)) {
    throw new Error(`sender doesn't have enough funds to send tx. The msg.value is: ${tx.value.toString()} and the sender's account only has: ${balance.toString()}`);
  }
  // estimate user fee and free fee
  const { fee, freeFee, contractFee } = await router.estimateTotalFee(sender, tx.to ?? Address.zero(), timestamp);
  // totalFeeLeft = feeLeft + freeFeeLeft + contractFeeLeft
  const totalFeeLeft = fee.add(freeFee).add(contractFee);
  // maxCostLimit = totalFeeLeft + user.balance
  const maxCostLimit = balance.add(totalFeeLeft);
  const cost = tx.getUpfrontCost();
  // balance check
  // if the maxCostLimit is less than UpfrontCost, throw a error
  if (maxCostLimit.lt(cost)) {
    throw new Error(`sender doesn't have enough funds to send tx. The upfront cost is: ${cost.toString()} and the sender's account only has: ${maxCostLimit.toString()}`);
  }
  return { fee, freeFee, contractFee };
}
