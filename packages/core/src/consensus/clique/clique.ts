import { BaseTrie } from 'merkle-patricia-tree';
import { toBuffer, Address, BN } from 'ethereumjs-util';
import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { Blockchain } from '@gxchain2/blockchain';
import { TypedTransaction, BlockHeader, Block, CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN } from '@gxchain2/structure';

export class Clique {
  // disable contructor
  private constructor() {}

  static getMiner(data: BlockHeader | Block): Address {
    const header = data instanceof Block ? data.header : data;
    return header.cliqueSigner();
  }

  /**
   * Generate receipt root before `hf1`
   * @param transactions - List of transaction
   * @param receipts - List of receipt
   * @returns Receipt root
   */
  static async genReceiptTrie(transactions: TypedTransaction[], receipts: TxReceipt[]) {
    const trie = new BaseTrie();
    for (let i = 0; i < receipts.length; i++) {
      await trie.put(toBuffer(i), encodeReceipt(transactions[i], receipts[i]));
    }
    return trie.root;
  }

  static calcCliqueDifficulty(activeSigners: Address[], signer: Address, number: BN): [boolean, BN] {
    if (activeSigners.length === 0) {
      throw new Error('Missing active signers information');
    }
    const signerIndex = activeSigners.findIndex((address: Address) => address.equals(signer));
    if (signerIndex === -1) {
      throw new Error('invalid signer');
    }
    const inTurn = number.modn(activeSigners.length) === signerIndex;
    return [inTurn, (inTurn ? CLIQUE_DIFF_INTURN : CLIQUE_DIFF_NOTURN).clone()];
  }

  static consensusValidateHeader(this: BlockHeader, blockchain: Blockchain) {
    const miner = this.cliqueSigner();
    const activeSigners = blockchain.cliqueActiveSignersByBlockNumber(this.number);
    if (activeSigners.findIndex((addr) => addr.equals(miner)) === -1) {
      throw new Error('invalid validator, missing from active signer');
    }
    const [, diff] = Clique.calcCliqueDifficulty(activeSigners, this.cliqueSigner(), this.number);
    if (!diff.eq(this.difficulty)) {
      throw new Error('invalid difficulty');
    }
    if ((blockchain as any).cliqueCheckRecentlySigned(this)) {
      throw new Error('clique recently signed');
    }
  }
}
