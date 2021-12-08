import fs from 'fs';
import path from 'path';
import Semaphore from 'semaphore-async-await';
import { TransactionFactory, Transaction } from '@rei-network/structure';
import { logger } from '@rei-network/utils';
import { Node } from '../node';

const bufferSplit = Buffer.from('\r\n');

/**
 * Journal manage local transaction rlp record
 */
export class Journal {
  private path: string;
  private dir: string;
  private lock = new Semaphore(1);
  private writer?: fs.WriteStream;
  private readonly node: Node;

  /**
   * @param dir - Node database full path
   * @param node - Node instance
   */
  constructor(dir: string, node: Node) {
    this.dir = dir;
    this.path = path.join(dir, 'transactions.rlp');
    this.node = node;
  }

  /**
   * Create write stream if not exists
   */
  private createWritterIfNotExists() {
    if (!this.writer) {
      this.writer = fs.createWriteStream(this.path, { flags: 'a' });
    }
  }

  /**
   * Close write stream
   */
  private async closeWritter() {
    if (this.writer) {
      await new Promise((r) => {
        this.writer!.end(r);
      });
      this.writer = undefined;
    }
  }

  /**
   * Load and parse all transactions from disk
   * @param add - Callback for each transaction
   */
  load(add: (transactions: Transaction[]) => Promise<void>) {
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.dir, { recursive: true });
      return;
    }

    return new Promise<boolean>(async (resolve) => {
      const inputer = fs.createReadStream(this.path, { autoClose: true });
      let batch: Transaction[] = [];
      let bufferInput: Buffer | undefined;
      inputer.on('data', (chunk: Buffer) => {
        try {
          if (bufferInput === undefined) {
            bufferInput = chunk;
          } else {
            bufferInput = Buffer.concat([bufferInput, chunk]);
          }
          while (true) {
            const i = bufferInput.indexOf(bufferSplit);
            if (i === -1) {
              break;
            }
            const tx = TransactionFactory.fromSerializedData(bufferInput.slice(0, i), { common: this.node.getLatestCommon() });
            if (tx instanceof Transaction) {
              batch.push(tx);
              if (batch.length > 1024) {
                add(batch);
                batch = [];
              }
            }
            bufferInput = bufferInput.slice(i + bufferSplit.length);
          }
          if (batch.length > 0) {
            add(batch);
          }
        } catch (err) {
          logger.error('Jonunal::load, catch error:', err);
          resolve(false);
        }
      });

      inputer.on('end', () => {
        resolve(true);
      });

      inputer.on('error', (err) => {
        logger.error('Jonunal::load, read stream error:', err);
        resolve(false);
      });
    });
  }

  /**
   * Write transaction rlp to the disk
   * @param tx - Transaction
   */
  async insert(tx: Transaction) {
    await this.lock.acquire();
    this.createWritterIfNotExists();
    await new Promise<void>((resolve) => {
      this.writer!.write(Buffer.concat([tx.serialize(), bufferSplit]), (err) => {
        if (err) {
          logger.error('Jonunal::insert, write stream error:', err);
        }
        resolve();
      });
    });
    this.lock.release();
  }

  /**
   * Rotate all transactions in memory
   * @param all - The map contains all transactions
   */
  async rotate(all: Map<Buffer, Transaction[]>) {
    await this.lock.acquire();
    try {
      await this.closeWritter();
      const output = fs.createWriteStream(this.path + '.new');

      let journaled = 0;
      await Promise.all(
        Array.from(all.values())
          .reduce((a, b) => a.concat(b), [])
          .map(
            (tx) =>
              new Promise<void>((resolve) => {
                output.write(Buffer.concat([tx.serialize(), bufferSplit]), (err) => {
                  if (err) {
                    logger.error('Jonunal::rotate, write stream error:', err);
                  } else {
                    journaled++;
                  }
                  resolve();
                });
              })
          )
      );

      await new Promise((r) => {
        output.end(r);
      });

      fs.renameSync(this.path + '.new', this.path);
      logger.info('Regenerated local transaction journal, transactions', journaled, 'accounts', all.size);
    } catch (err) {
      logger.error('Journal::rotate, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  async close() {
    await this.closeWritter();
  }
}
