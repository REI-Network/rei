import fs from 'fs';
import path from 'path';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { Address } from 'ethereumjs-util';
import { INode } from './index';
import { logger } from '@gxchain2/utils';

const bufferSplit = Buffer.from('\r\n');

export class Jonunal {
  private path: string;
  private dir: string;
  private writer?: fs.WriteStream;
  private readonly node: INode;
  constructor(dir: string, node: INode) {
    this.dir = dir;
    this.path = path.join(dir, 'transactions.rlp');
    this.node = node;
  }

  createWritter() {
    if (!this.writer) {
      this.writer = fs.createWriteStream(this.path, { flags: 'a' });
    }
  }

  async closeWritter() {
    if (this.writer) {
      await new Promise((r) => {
        this.writer!.end(r);
      });
      this.writer = undefined;
    }
  }

  async load(add: (transactions: WrappedTransaction[]) => Promise<void>) {
    return new Promise<void>(async (resolve, reject) => {
      if (!fs.existsSync(this.path)) {
        fs.mkdirSync(this.dir, { recursive: true });
        resolve();
        return;
      }

      await this.closeWritter();

      const inputer = fs.createReadStream(this.path);
      let batch: WrappedTransaction[] = [];
      let bufferInput: Buffer | undefined;
      inputer.on('data', (chunk: Buffer) => {
        bufferInput = Buffer.concat(bufferInput ? [bufferInput, chunk] : [chunk]);
        while (true) {
          const i = bufferInput.indexOf(bufferSplit);
          if (i == -1) {
            break;
          }
          const tx = new WrappedTransaction(Transaction.fromRlpSerializedTx(bufferInput.slice(0, i), { common: this.node.common }));
          batch.push(tx);
          if (batch.length > 1024) {
            add(batch);
            batch = [];
          }
          bufferInput = bufferInput.slice(i + bufferSplit.length);
        }
        if (batch.length > 0) {
          add(batch);
        }
      });

      inputer.on('end', () => {
        resolve();
      });

      inputer.on('error', (err) => {
        reject(err);
      });
    });
  }

  insert(tx: WrappedTransaction) {
    this.createWritter();
    return new Promise<void>((resolve, reject) => {
      this.writer!.write(Buffer.concat([tx.transaction.serialize(), bufferSplit]), (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async rotate(all: Map<Buffer, WrappedTransaction[]>) {
    await this.closeWritter();
    const output = fs.createWriteStream(this.path + '.new');
    let journaled = 0;
    const array: Promise<void>[] = [];
    for (const [key, val] of all) {
      for (const tx of val) {
        array.push(
          new Promise<void>((resolve, reject) => {
            output.write(Buffer.concat([tx.transaction.serialize(), bufferSplit]), (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
        );
      }
      journaled += val.length;
    }
    try {
      await Promise.all(array);
    } catch (err) {
      return;
    } finally {
      await new Promise((r) => {
        output.end(r);
      });
    }

    fs.renameSync(this.path + '.new', this.path);
    logger.info('Regenerated local transaction journal, transactions', journaled, 'accounts', all.size);
  }

  async close() {
    await this.closeWritter();
    return;
  }
}
