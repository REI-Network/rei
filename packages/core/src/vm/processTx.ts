import { BN, Address } from 'ethereumjs-util';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { RunTxOpts, RunTxResult, generateTxReceipt as EthereumGenerateTxReceipt } from '@gxchain2-ethereumjs/vm/dist/runTx';
import VM from '@gxchain2-ethereumjs/vm';
import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { Log } from '@gxchain2-ethereumjs/vm/dist/evm/types';
import { TypedTransaction, Transaction, Block } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Router } from '../contracts';
import { validateTx } from '../validation';
import { isEnableStaking } from '../hardforks';
import { Node } from '../node';

// After HF1 function
export function makeRunTxCallback(router: Router, systemCaller: Address, miner: Address, timestamp: number) {
  let feeLeft!: BN;
  let freeFeeLeft!: BN;
  let contractFeeLeft!: BN;
  let balanceLeft!: BN;
  let logs!: Log[];

  const beforeTx = async (state: IStateManager, tx: TypedTransaction, txCost: BN) => {
    const caller = tx.getSenderAddress();
    const fromAccount = await state.getAccount(caller);
    const result = await validateTx(tx as Transaction, router, caller, timestamp, fromAccount.balance);

    feeLeft = result.fee;
    freeFeeLeft = result.freeFee;
    contractFeeLeft = result.contractFee;
    balanceLeft = fromAccount.balance.sub(tx.value);

    // update caller's nonce
    fromAccount.nonce.iaddn(1);
    // don't reduce caller balance
    // fromAccount.balance.isub(txCost);
    await state.putAccount(caller, fromAccount);
  };

  const afterTx = async (state: IStateManager, tx: TypedTransaction, _actualTxCost: BN) => {
    // calculate fee, free fee and balance usage
    let actualTxCost = _actualTxCost.clone();
    let feeUsage = new BN(0);
    let freeFeeUsage = new BN(0);
    let contractFeeUsage = new BN(0);
    let balanceUsage = new BN(0);
    // 1. consume contract fee
    if (actualTxCost.gte(contractFeeLeft)) {
      contractFeeUsage = contractFeeLeft.clone();
      actualTxCost.isub(contractFeeLeft);
    } else {
      contractFeeUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }
    // 2. consume user's fee
    if (actualTxCost.gte(feeLeft)) {
      feeUsage = feeLeft.clone();
      actualTxCost.isub(feeLeft);
    } else if (actualTxCost.gtn(0)) {
      feeUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }
    // 3. consume user's free fee
    if (actualTxCost.gt(freeFeeLeft)) {
      freeFeeUsage = freeFeeLeft.clone();
      actualTxCost.isub(freeFeeLeft);
    } else if (actualTxCost.gtn(0)) {
      freeFeeUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }
    // 4. consume user's balance
    if (actualTxCost.gt(balanceLeft)) {
      // this shouldn't happened
      throw new Error('balance left is not enough for actualTxCost, revert tx');
    } else if (actualTxCost.gtn(0)) {
      balanceUsage = actualTxCost.clone();
      actualTxCost = new BN(0);
    }
    logger.debug('Node::processTx, makeRunTxCallback::afterTx, tx:', '0x' + tx.hash().toString('hex'), 'actualTxCost:', _actualTxCost.toString(), 'feeUsage:', feeUsage.toString(), 'freeFeeUsage:', freeFeeUsage.toString(), 'contractFeeUsage:', contractFeeUsage.toString(), 'balanceUsage:', balanceUsage.toString());

    const caller = tx.getSenderAddress();
    if (balanceUsage.gtn(0)) {
      // reduce balance for transaction sender
      const fromAccount = await state.getAccount(caller);
      if (balanceUsage.gt(fromAccount.balance)) {
        // this shouldn't happened
        throw new Error('balance left is not enough for balanceUsage, revert tx');
      }
      fromAccount.balance.isub(balanceUsage);
      await state.putAccount(caller, fromAccount);

      // add balance to system caller
      const systemCallerAccount = await state.getAccount(systemCaller);
      systemCallerAccount.balance.iadd(balanceUsage);
      await state.putAccount(systemCaller, systemCallerAccount);
    }
    // call the router contract and collect logs
    logs = await router.assignTransactionReward(miner, caller, tx.to ?? Address.zero(), feeUsage, freeFeeUsage, balanceUsage, contractFeeUsage);
  };

  async function generateTxReceipt(this: VM, tx: TypedTransaction, txResult: RunTxResult, cumulativeGasUsed: BN): Promise<TxReceipt> {
    const receipt = await EthereumGenerateTxReceipt.bind(this)(tx, txResult, cumulativeGasUsed);
    // append `UsageInfo` log to receipt
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

export interface ProcessTxOptions extends Omit<RunTxOpts, 'block' | 'beforeTx' | 'afterTx' | 'assignTxReward' | 'generateTxReceipt' | 'skipBalance'> {
  block: Block;
  vm: VM;
}

export function processTx(this: Node, options: ProcessTxOptions) {
  const { vm, block } = options;
  const parentEnableStaking = !block.isGenesis() && isEnableStaking(this.getCommon(block.header.number.subn(1)));
  if (parentEnableStaking) {
    const systemCaller = Address.fromString(block._common.param('vm', 'scaddr'));
    const router = this.getRouter(vm, block);
    return vm.runTx({
      ...options,
      skipBalance: true,
      ...makeRunTxCallback(router, systemCaller, block.header.cliqueSigner(), block.header.timestamp.toNumber())
    });
  } else {
    return vm.runTx(options);
  }
}
