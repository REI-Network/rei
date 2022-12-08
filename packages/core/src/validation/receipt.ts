import { BaseTrie } from '@rei-network/trie';
import { rlp } from 'ethereumjs-util';
import { Receipt, Block } from '@rei-network/structure';

export async function validateReceipts(block: Block, receipts: Receipt[]) {
  if (block.transactions.length !== receipts.length) {
    throw new Error('the length of the transaction and the length of the receipt are not equal');
  }

  // TODO: For the sake of simplicity,
  //       the calculation method of receiptTrie is not discussed here.
  const trie = new BaseTrie();
  for (let i = 0; i < receipts.length; i++) {
    await trie.put(rlp.encode(i), receipts[i].serialize());
  }
  if (!trie.root.equals(block.header.receiptTrie)) {
    throw new Error('invalid receipt trie');
  }
}
