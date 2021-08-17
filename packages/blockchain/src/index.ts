import { BN, Address } from 'ethereumjs-util';
import EthereumBlockchain, { BlockchainOptions as EthereumBlockchainOptions } from '@gxchain2-ethereumjs/blockchain';
import { CliqueLatestBlockSigners } from '@gxchain2-ethereumjs/blockchain/dist/clique';
import { CliqueLatestSignerStates } from '@gxchain2-ethereumjs/blockchain/dist/clique';
import { Block, BlockHeader } from '@gxchain2/structure';
import { Database } from '@gxchain2/database';

/**
 * Blockchain represents the canonical chain given a database with a genesis
 * block. The Blockchain manages chain imports, reverts, chain reorganisations.
 */
export class Blockchain extends EthereumBlockchain {
  private _latestBlock!: Block;
  private _totalDifficulty!: BN;

  /**
   * Return blockchain's latest block
   */
  get latestBlock() {
    return this._latestBlock;
  }

  /**
   * Return blockchain's latest block's number, if not exsit, return 0
   */
  get latestHeight() {
    return this._latestBlock?.header?.number?.toNumber() || 0;
  }

  /**
   * Return blockchain's latest block's hash with '0x' prefix, if not exsit, return '0x00'
   */
  get latestHash() {
    return '0x' + (this._latestBlock?.header?.hash()?.toString('hex') || '00');
  }

  /**
   * Return blockchain's totalDifficulty
   */
  get totalDifficulty() {
    return this._totalDifficulty.clone();
  }

  /**
   * This method check and update the latestBlock and totalDifficulty of blockchain
   */
  private async updateLatest() {
    const latestBlock = await this.getLatestBlock();
    if (!this._latestBlock || !latestBlock.header.hash().equals(this._latestBlock.header.hash())) {
      this._latestBlock = latestBlock;
      this._totalDifficulty = await this.getTotalDifficulty(latestBlock.hash(), latestBlock.header.number);
    }
  }

  /**
   * Initialize
   */
  async init() {
    await this.initPromise;
    await this.updateLatest();
  }

  /**
   * Adds a block to the blockchain by calling the method 'putBlock' of parent class
   * Update the blockchain's latest status
   *
   * @param block - The block to be added to the blockchain
   */
  async putBlock(block: Block) {
    await super.putBlock(block);
    await this.updateLatest();
  }

  /**
   * Get active clique signers by block number, return signer addresses
   * @param number - The number of block
   * @returns Active clique signers
   */
  cliqueActiveSignersByBlockNumber(number: BN): Address[] {
    const _cliqueLatestSignerStates: CliqueLatestSignerStates = (this as any)._cliqueLatestSignerStates;
    for (let i = _cliqueLatestSignerStates.length - 1; i >= 0; i--) {
      const state = _cliqueLatestSignerStates[i];
      if (state[0].gt(number)) {
        continue;
      }
      return [...state[1]];
    }
    return [];
  }

  /**
   * Check if the signer can sign the next block
   * @param currentHeader - current block header
   * @param signer - the signer of next block
   * @returns
   */
  cliqueCheckNextRecentlySigned(currentHeader: BlockHeader, signer: Address): boolean {
    if (currentHeader.isGenesis()) {
      return false;
    }
    const limit: number = (this as any).cliqueSignerLimit();
    let signers: CliqueLatestBlockSigners = (this as any)._cliqueLatestBlockSigners;
    signers = signers.slice(signers.length < limit ? 0 : 1);
    signers.push([currentHeader.number.addn(1), signer]);
    const seen = signers.filter((s) => s[1].equals(signer)).length;
    return seen > 1;
  }
}
