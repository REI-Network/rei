import { Address, BN, bufferToHex, toBuffer } from 'ethereumjs-util';
import { RunTxResult, generateTxReceipt as EthereumGenerateTxReceipt } from '@rei-network/vm/dist/runTx';
import { TxReceipt } from '@rei-network/vm/dist/types';
import { Log as EthereumLog } from '@rei-network/vm/dist/evm/types';
import { TypedTransaction, Transaction } from '@rei-network/structure';
import { logger } from '@rei-network/utils';
import { VM } from '@rei-network/vm';
import { StateManager as IStateManager } from '@rei-network/vm/dist/state';
import { StateManager } from '../../stateManager';
import { validateTx } from '../../validation';
import { encode } from './contracts';

const usageTopic = toBuffer('0x873c82cd37aaacdcf736cbb6beefc8da36d474b65ad23aaa1b1c6fbd875f7076');

export function makeRunTxCallback(systemCaller: Address, feeAddr: Address, timestamp: number, totalAmount: BN) {
  let feeLeft!: BN;
  let balanceLeft!: BN;
  let logs!: EthereumLog[];

  const beforeTx = async (state: IStateManager, tx: TypedTransaction, txCost: BN) => {
    const caller = tx.getSenderAddress();
    const fromAccount = await state.getAccount(caller);
    const { fee } = await validateTx(tx as Transaction, timestamp, state as StateManager, totalAmount);

    feeLeft = fee!;
    balanceLeft = fromAccount.balance.sub(tx.value);

    // update caller's nonce
    fromAccount.nonce.iaddn(1);
    // don't reduce caller balance
    // fromAccount.balance.isub(tx.value);
    await state.putAccount(caller, fromAccount);
  };

  const afterTx = async (state: IStateManager, tx: TypedTransaction, _actualTxCost: BN) => {
    // calculate fee, free fee and balance usage
    let actualTxCost = _actualTxCost.clone();
    let feeUsage = new BN(0);
    let balanceUsage = new BN(0);

    // 1. consume user's fee
    if (actualTxCost.gte(feeLeft)) {
      feeUsage = feeLeft.clone();
      actualTxCost.isub(feeLeft);
    } else if (actualTxCost.gtn(0)) {
      feeUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }

    // 2. consume user's balance
    if (actualTxCost.gt(balanceLeft)) {
      // this shouldn't happened
      throw new Error('balance left is not enough for actualTxCost, revert tx');
    } else if (actualTxCost.gtn(0)) {
      balanceUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }

    logger.debug('Reimint::processTx, makeRunTxCallback::afterTx, tx:', bufferToHex(tx.hash()), 'actualTxCost:', _actualTxCost.toString(), 'feeUsage:', feeUsage.toString(), 'balanceUsage:', balanceUsage.toString());

    const caller = tx.getSenderAddress();
    const fromAccount = await (state as StateManager).getAccount(caller);

    // 3. consume user fee, if feeUsage is greater than 0
    if (feeUsage.gtn(0)) {
      fromAccount.getStakeInfo().consume(feeUsage, timestamp);
    }

    // 4. reduce balance for transaction sender, if balanceUsage is greater than 0
    if (balanceUsage.gtn(0)) {
      if (balanceUsage.gt(fromAccount.balance)) {
        // this shouldn't happened
        throw new Error('balance left is not enough for balanceUsage, revert tx');
      }
      fromAccount.balance.isub(balanceUsage);

      // add balance usage to system caller
      const systemCallerAccount = await state.getAccount(systemCaller);
      systemCallerAccount.balance.iadd(balanceUsage);
      await state.putAccount(systemCaller, systemCallerAccount);
    }

    await state.putAccount(caller, fromAccount);

    // 5. generate usage info log
    // address: fee contract address
    // topic[0]: keccak256('Usage(uint256,uint256)')
    // topic[1]: abiencode(feeUsage)
    // topic[2]: abiencode(balanceUsage)
    logs = [[feeAddr.buf, [usageTopic, encode(['uint256'], [feeUsage.toString()]), encode(['uint256'], [balanceUsage.toString()])], Buffer.alloc(0)]];
  };

  async function generateTxReceipt(this: VM, tx: TypedTransaction, txResult: RunTxResult, cumulativeGasUsed: BN): Promise<TxReceipt> {
    const receipt = await EthereumGenerateTxReceipt.bind(this)(tx, txResult, cumulativeGasUsed);
    // append `Usage` log to the receipt
    receipt.logs = receipt.logs.concat(logs);
    return receipt;
  }

  return {
    beforeTx,
    afterTx,
    assignTxReward: async () => {},
    generateTxReceipt
  };
}
