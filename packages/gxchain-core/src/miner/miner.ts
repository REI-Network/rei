import { hexStringToBN, hexStringToBuffer, logger, getRandomIntInclusive } from '@gxchain2/utils';
import { Block, CLIQUE_DIFF_NOTURN } from '@gxchain2/block';
import { Worker } from './worker';
import { Loop } from './loop';
import { Node } from '../node';
import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { getPrivateKey } from '../fakeaccountmanager';

export interface MinerOptions {
  coinbase: string;
  gasLimit: string;
}

export class Miner extends Loop {
  public readonly worker: Worker;

  private _coinbase: Buffer;
  private _gasLimit: BN;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;

  constructor(node: Node, options?: MinerOptions) {
    super(0);
    this.node = node;
    this.options = options;
    this._coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : Address.zero().buf;
    this._gasLimit = this?.options?.gasLimit ? hexStringToBN(this.options.gasLimit) : hexStringToBN('0xbe5c8b');
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', () => {
      this.worker.stopLoop();
      this.stopLoop();
    });
    node.sync.on('synchronized', () => {
      this.worker.startLoop();
      this.startLoop();
    });
    node.sync.on('synchronize failed', () => {
      this.worker.startLoop();
      this.startLoop();
    });
  }

  /**
   * Get the mining state
   */
  get isMining() {
    return !!this.options;
  }

  /**
   * Get the coinbase
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * Get the limit of gas
   */
  get gasLimit() {
    return this._gasLimit;
  }

  /**
   * Set the coinbase
   * @param coinbase
   */
  setCoinbase(coinbase: string | Buffer) {
    this._coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
  }

  /**
   * Set the gas limit
   * @param gasLimit
   */
  setGasLimit(gasLimit: string | BN) {
    this._gasLimit = typeof gasLimit === 'string' ? hexStringToBN(gasLimit) : gasLimit;
  }

  /**
   * Initialize the miner
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.worker.init();
    this.worker.startLoop();
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Start the loop
   */
  startLoop() {
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Mint the Block
   */
  async mint() {
    await this.initPromise;
    let header = this.node.blockchain.latestBlock.header;
    const period: number = header._common.consensusConfig().period;
    let now!: number;
    let block!: Block;
    while (true) {
      now = Math.floor(Date.now() / 1000);
      let sleep = period - (now - header.timestamp.toNumber());
      let flag = false;
      if (sleep > 0) {
        logger.debug('Miner::mint, sleep for block period', sleep, 'next block', header.number.addn(1).toNumber(), 'should be mined at', header.timestamp.toNumber() + period);
        await new Promise((r) => setTimeout(r, sleep * 1000));
      } else {
        flag = true;
      }

      const record = await this.worker.getRecord_OrderByTD(header.number);
      if (record) {
        if (flag) {
          block = record[1];
          if (block.header.cliqueIsEpochTransition()) {
            logger.debug(
              'Miner::mint, epoch transition block, active signers:',
              this.node.blockchain.cliqueActiveSignersByBlockNumber(block.header.number).map((addr) => addr.toString())
            );
          }
          block = Block.fromBlockData(
            {
              header: {
                ...block.header,
                timestamp: now,
                extraData: block.header.cliqueIsEpochTransition() ? Buffer.concat([Buffer.alloc(32), ...this.node.blockchain.cliqueActiveSignersByBlockNumber(block.header.number).map((addr) => addr.toBuffer()), Buffer.alloc(65)]) : undefined
              },
              transactions: block.transactions
            },
            { common: this.node.getCommon(block.header.number), cliqueSigner: getPrivateKey(this.coinbase.toString('hex')) }
          );
        } else {
          header = record[0];
        }
      } else {
        logger.debug('Miner::mint, missing parent block header in worker, stop minting', header.number.toNumber());
        return;
      }

      if (flag) {
        break;
      }
    }

    if (block.header.difficulty.eq(CLIQUE_DIFF_NOTURN)) {
      if (!this.working) {
        return;
      }
      if (!header.hash().equals(this.node.blockchain.latestBlock.header.hash())) {
        return;
      }
      const signerCount = this.node.blockchain.cliqueActiveSigners().length;
      const sleep2 = getRandomIntInclusive(1, signerCount + 1) * 200;
      logger.debug('Miner::mint, not turn, random sleep', sleep2);
      await new Promise((r) => setTimeout(r, sleep2));
      logger.debug('Miner::mint, not turn, sleep over');
      if (!this.working) {
        return;
      }
      if (!header.hash().equals(this.node.blockchain.latestBlock.header.hash())) {
        return;
      }
    } else {
      logger.debug('Miner::mint, in turn');
    }
    logger.debug('Miner::mint, start mint');
    const beforeMint = this.node.blockchain.latestBlock.hash();
    const newBlock = await this.node.processBlock(block);
    const afterMint = this.node.blockchain.latestBlock.hash();
    if (!beforeMint.equals(afterMint)) {
      await this.node.newBlock(newBlock);
    }
    logger.debug('Miner::mint, mint over');
    logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
  }

  protected async process() {
    try {
      await this.mint();
    } catch (err) {
      logger.error('Miner::process, catch error:', err);
    }
  }
}
