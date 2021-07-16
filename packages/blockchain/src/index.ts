import { BN, Address } from 'ethereumjs-util';
import EthereumBlockchain, { BlockchainOptions as EthereumBlockchainOptions } from '@ethereumjs/blockchain';
import { CliqueLatestBlockSigners } from '@ethereumjs/blockchain/dist/clique';
import { CliqueLatestSignerStates } from '@ethereumjs/blockchain/dist/clique';
import { Block, BlockHeader } from '@gxchain2/structure';
import { Database } from '@gxchain2/database';

export interface BlockchainOptions extends EthereumBlockchainOptions {
  database: Database;
}

export class Blockchain extends EthereumBlockchain {
  dbManager: Database;
  private _latestBlock!: Block;
  private _totalDifficulty!: BN;

  constructor(opts: BlockchainOptions) {
    super(opts);
    this.dbManager = opts.database;
  }

  get latestBlock() {
    return this._latestBlock;
  }

  get latestHeight() {
    return this._latestBlock?.header?.number?.toNumber() || 0;
  }

  get latestHash() {
    return '0x' + (this._latestBlock?.header?.hash()?.toString('hex') || '00');
  }

  get totalDifficulty() {
    return this._totalDifficulty.clone();
  }

  private async updateLatest() {
    const latestBlock = await this.getLatestBlock();
    if (!this._latestBlock || !latestBlock.header.hash().equals(this._latestBlock.header.hash())) {
      this._latestBlock = latestBlock;
      this._totalDifficulty = await this.getTotalDifficulty(latestBlock.hash(), latestBlock.header.number);
    }
  }

  async init() {
    await this.initPromise;
    await this.updateLatest();
  }

  async putBlock(block: Block) {
    await super.putBlock(block);
    await this.updateLatest();
  }

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
