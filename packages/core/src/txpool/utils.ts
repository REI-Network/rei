import { Transaction } from '@rei-network/structure';
import { MAX_UINT64 } from '../utils';

/**
 * Calculate the transaction slots
 * @param tx - Transaction
 * @returns Transaction slots
 */
export function txSlots(tx: Transaction) {
  return Math.ceil(tx.size / 32768);
}

/**
 * Calulate the transaction cost
 * @param tx - Transaction
 * @returns Transaction cost
 */
export function txCost(tx: Transaction) {
  return tx.value.add(tx.gasPrice.mul(tx.gasLimit));
}

/**
 * Check transaction intrinsic gas
 * @param tx - Transaction
 * @returns `true` if valid, `false` if not
 */
export function checkTxIntrinsicGas(tx: Transaction) {
  const gas = tx.getBaseFee();
  return gas.lte(MAX_UINT64) && gas.lte(tx.gasLimit);
}
