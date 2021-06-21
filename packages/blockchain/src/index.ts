import { EventEmitter } from 'events';
import { BN, Address } from 'ethereumjs-util';
import EthereumBlockchain, { BlockchainOptions as EthereumBlockchainOptions } from '@ethereumjs/blockchain';
import { CliqueLatestSignerStates } from '@ethereumjs/blockchain/dist/clique';
import { Block, BlockHeader } from '@gxchain2/structure';
import { Database, DBSetTD, DBSetBlockOrHeader, DBSetHashToNumber, DBOp } from '@gxchain2/database';

export interface BlockchainOptions extends EthereumBlockchainOptions {
  database: Database;
}

export declare interface BlockchainEventEmitter {
  on(event: 'updated', listener: (block: Block) => void): this;

  once(event: 'updated', listener: (block: Block) => void): this;
}

export class BlockchainEventEmitter extends EventEmitter {}

/**
 * This class stores and interacts with blocks, based on EthereumBlockchain
 */
export class Blockchain extends EthereumBlockchain {
  event: BlockchainEventEmitter = new BlockchainEventEmitter();
  dbManager: Database;
  private _latestBlock!: Block;
  private _totalDifficulty!: BN;

  constructor(opts: BlockchainOptions) {
    super(Object.assign(opts, { validateConsensus: false }));
    this.dbManager = opts.database;
    const self = this as any;
    // fix _putBlockOrHeader.
    self._putBlockOrHeader = async (item: Block | BlockHeader) => {
      await self.runWithLock(async () => {
        const block =
          item instanceof BlockHeader
            ? new Block(item, undefined, undefined, {
                common: self._common,
                hardforkByBlockNumber: true
              })
            : item;
        const isGenesis = block.isGenesis();

        // we cannot overwrite the Genesis block after initializing the Blockchain

        if (isGenesis) {
          throw new Error('Cannot put a genesis block: create a new Blockchain');
        }

        const { header } = block;
        const blockHash = header.hash();
        const blockNumber = header.number;
        const td = header.difficulty.clone();
        const currentTd = { header: new BN(0), block: new BN(0) };
        let dbOps: DBOp[] = [];

        if (!block._common.chainIdBN().eq(self._common.chainIdBN())) {
          throw new Error('Chain mismatch while trying to put block or header');
        }

        if (self._validateBlocks && !isGenesis) {
          // this calls into `getBlock`, which is why we cannot lock yet
          await block.validate(self);
        }

        if (self._validateConsensus) {
          if (self._common.consensusAlgorithm() === 'ethash') {
            const valid = await self._ethash!.verifyPOW(block);
            if (!valid) {
              throw new Error('invalid POW');
            }
          }

          if (self._common.consensusAlgorithm() === 'clique') {
            const valid = header.cliqueVerifySignature(self.cliqueActiveSigners());
            if (!valid) {
              throw new Error('invalid PoA block signature (clique)');
            }

            if (self.cliqueCheckRecentlySigned(header)) {
              throw new Error('recently signed');
            }
          }
        }

        if (self._common.consensusAlgorithm() === 'clique') {
          // validate checkpoint signers towards active signers on epoch transition blocks
          if (header.cliqueIsEpochTransition()) {
            // note: keep votes on epoch transition blocks in case of reorgs.
            // only active (non-stale) votes will counted (if vote.blockNumber >= lastEpochBlockNumber)

            const checkpointSigners = header.cliqueEpochTransitionSigners();
            const activeSigners = self.cliqueActiveSigners();
            for (const [i, cSigner] of checkpointSigners.entries()) {
              if (!activeSigners[i] || !activeSigners[i].equals(cSigner)) {
                throw new Error(`checkpoint signer not found in active signers list at index ${i}: ${cSigner.toString()}`);
              }
            }
          }
        }

        // set total difficulty in the current context scope
        if (self._headHeaderHash) {
          currentTd.header = await self.getTotalDifficulty(self._headHeaderHash);
        }
        if (self._headBlockHash) {
          currentTd.block = await self.getTotalDifficulty(self._headBlockHash);
        }

        // calculate the total difficulty of the new block
        let parentTd = new BN(0);
        if (!block.isGenesis()) {
          parentTd = await self.getTotalDifficulty(header.parentHash, blockNumber.subn(1));
        }
        td.iadd(parentTd);

        // save total difficulty to the database
        dbOps = dbOps.concat(DBSetTD(td, blockNumber, blockHash));

        // save header/block to the database
        dbOps = dbOps.concat(DBSetBlockOrHeader(block));

        // if total difficulty is higher than current, add it to canonical chain
        if (block.isGenesis() || td.gt(currentTd.header)) {
          self._headHeaderHash = blockHash;
          if (item instanceof Block) {
            self._headBlockHash = blockHash;
          }

          // TODO SET THIS IN CONSTRUCTOR
          if (block.isGenesis()) {
            self._genesis = blockHash;
          }

          // Clique: update signer votes and state
          if (self._common.consensusAlgorithm() === 'clique') {
            if (!header.cliqueIsEpochTransition()) {
              await self.cliqueUpdateVotes(header);
            }
            await self.cliqueUpdateLatestBlockSigners(header);
          }

          // delete higher number assignments and overwrite stale canonical chain
          await self._deleteCanonicalChainReferences(blockNumber.addn(1), blockHash, dbOps);
          // from the current header block, check the blockchain in reverse (i.e.
          // traverse `parentHash`) until `numberToHash` matches the current
          // number/hash in the canonical chain also: overwrite any heads if these
          // heads are stale in `_heads` and `_headBlockHash`
          await self._rebuildCanonical(header, dbOps);
        } else {
          // the TD is lower than the current highest TD so we will add the block
          // to the DB, but will not mark it as the canonical chain.
          if (td.gt(currentTd.block) && item instanceof Block) {
            self._headBlockHash = blockHash;
          }
          // save hash to number lookup info even if rebuild not needed
          dbOps.push(DBSetHashToNumber(blockHash, blockNumber));
        }

        const ops = dbOps.concat(self._saveHeadOps());
        await self.dbManager.batch(ops);
      });
    };
  }
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
   * Return blockchain's latest block's hash, if not exsit, return '00'
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
   * This method check and update the latestBlock, totalDifficulty of blockchain, issue the 'update' event
   */
  private async updateLatest() {
    const latestBlock = await this.getLatestBlock();
    if (!this._latestBlock || !latestBlock.header.hash().equals(this._latestBlock.header.hash())) {
      this._latestBlock = latestBlock;
      this._totalDifficulty = await this.getTotalDifficulty(latestBlock.hash(), latestBlock.header.number);
      this.event.emit('updated', this._latestBlock);
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
   * Get active clique signers in a certain blocknumber, return addresses
   *
   * @param number - The number of block
   * @returns
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
}
