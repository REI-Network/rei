import { Address, BN } from 'ethereumjs-util';
import { Blockchain } from '@rei-network/blockchain';
import { BlockHeader, Block, CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN } from '@rei-network/structure';

export class Clique {
  // disable constructor
  private constructor() {}

  /**
   * Get miner address by block or block header
   * @param data - Block or block header
   * @returns Miner address
   */
  static getMiner(data: BlockHeader | Block): Address {
    const header = data instanceof Block ? data.header : data;
    return header.cliqueSigner();
  }

  /**
   * Calculate clique difficulty
   * @param activeSigners - List of active signer
   * @param signer - Local signer address
   * @param number - Block number
   * @returns Is the current signer an "inTurn" signer, and the block difficulty
   */
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

  /**
   * Validate clique header,
   * check if the difficulty is correct and signed recently
   * @param header - Block header
   * @param blockchain - Blockchain instance
   */
  static consensusValidateHeader(header: BlockHeader, blockchain: Blockchain) {
    const miner = header.cliqueSigner();
    const activeSigners = blockchain.cliqueActiveSignersByBlockNumber(header.number);
    if (activeSigners.findIndex((addr) => addr.equals(miner)) === -1) {
      throw new Error('invalid validator, missing from active signer');
    }
    const [, diff] = Clique.calcCliqueDifficulty(activeSigners, header.cliqueSigner(), header.number);
    if (!diff.eq(header.difficulty)) {
      throw new Error('invalid difficulty');
    }
    if ((blockchain as any).cliqueCheckRecentlySigned(header)) {
      throw new Error('clique recently signed');
    }
  }
}
