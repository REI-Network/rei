import { Receipt, Block } from '@rei-network/structure';

export function validateReceipts(block: Block, receipts: Receipt[]) {
  if (block.transactions.length !== receipts.length) {
    throw new Error('the length of the transaction and the length of the receipt are not equal');
  }

  // TODO: check bloom bits
}
