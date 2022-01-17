import { toBuffer, Address, BN } from 'ethereumjs-util';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Log, Receipt } from '@rei-network/structure';
import { FunctionalAddressMap } from '@rei-network/utils';
import { Contract } from './contract';
import { bufferToAddress } from './utils';

// function selector of fee
const methods = {
  totalAmount: toBuffer('0x1a39d8ef')
};

// event topic
const events = {
  Deposit: toBuffer('0x5548c837ab068cf56a2c2479df0882a4922fd203edb7517321831d95078c5f62'),
  Withdraw: toBuffer('0x9b1bfa7fa9ee420a16e124f794c35ac9f90472acc99140eb2f6447c714cad8eb')
};

export class Fee extends Contract {
  /**
   * Filter receipts and collect fee contract logs
   * @param receipts - Receipts
   * @param common - Common instance
   * @returns Account changes
   */
  static filterReceipts(receipts: Receipt[], common: Common) {
    const map = new FunctionalAddressMap<BN>();
    const faddr = Address.fromString(common.param('vm', 'faddr'));
    for (const receipt of receipts) {
      if (receipt.logs.length > 0) {
        Fee.filterLogs(receipt.logs, faddr, map);
      }
    }
    return map;
  }

  private static filterLogs(logs: Log[], faddr: Address, map: Map<Address, BN>) {
    const getAmount = (addr: Address) => {
      let amount = map.get(addr);
      if (amount === undefined) {
        amount = new BN(0);
        map.set(addr, amount);
      }
      return amount;
    };

    for (const log of logs) {
      if (log.address.equals(faddr.buf)) {
        if (log.topics.length === 4 && log.topics[0].equals(events['Deposit'])) {
          const addr = bufferToAddress(log.topics[2]);
          const amount = new BN(log.topics[3]);
          getAmount(addr).iadd(amount);
        } else if (log.topics.length === 4 && log.topics[0].equals(events['Withdraw'])) {
          const addr = bufferToAddress(log.topics[2]);
          const amount = new BN(log.topics[3]);
          getAmount(addr).isub(amount);
        }
      }
    }
  }

  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'faddr')));
  }

  /**
   * Read total amount from state trie
   * @returns Total amount
   */
  totalAmount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('totalAmount', [], []));
      return new BN(returnValue);
    });
  }
}
