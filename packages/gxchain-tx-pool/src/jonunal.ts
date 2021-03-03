import fs from 'fs';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { Address } from 'ethereumjs-util';
import { INode } from './index';

const bufferSplit = Buffer.from('\r\n');

export class Jonunal {
  path: string;
  writer?: fs.WriteStream;
  private readonly node: INode;
  constructor(path: string, node: INode) {
    this.path = path;
    this.writer = fs.createWriteStream(this.path, { flags: 'a' });
    this.node = node;
  }

  async load(add: (transactions: WrappedTransaction[]) => void) {
    return new Promise<void>(async (resolve, reject) => {
      if (!fs.existsSync(this.path)) {
        return;
      }
      if (this.writer) {
        await new Promise((r) => {
          this.writer!.end(r);
        });
        this.writer = undefined;
      }
      let inputer = fs.createReadStream(this.path);

      let total = 0;
      let dropped = 0;

      const loadBath = (txs: WrappedTransaction[]) => {
        txs.forEach((tx) => {
          let drops: WrappedTransaction[] = [];
          drops.push(tx);
          try {
            add(drops);
          } catch (err) {
            dropped++;
          }
        });
      };

      let batch: WrappedTransaction[] = [];
      let bufferInput: Buffer = Buffer.from('');
      inputer.on('data', (chunk: Buffer) => {
        bufferInput = Buffer.concat([bufferInput, chunk]);
        while (true) {
          let i = bufferInput.indexOf(bufferSplit);
          if (i == -1) {
            break;
          }
          let bufferTemp = Buffer.from(bufferInput);
          const tx = new WrappedTransaction(Transaction.fromRlpSerializedTx(bufferTemp.slice(0, i), { common: this.node.common }));
          total++;
          batch.push(tx);
          if (batch.length > 1024) {
            loadBath(batch);
            batch = [];
          }
          bufferInput = bufferInput.slice(i + bufferSplit.length);
        }
        if (batch.length > 0) {
          loadBath(batch);
        }
      });

      inputer.on('end', () => {
        console.log('Loaded local transaction journal', 'transactions', total, 'dropped', dropped);
        resolve();
      });

      inputer.on('error', (err) => {
        reject(err);
      });
    });
  }

  insert(tx: WrappedTransaction) {
    if (!this.writer) {
      this.writer = fs.createWriteStream(this.path, { flags: 'a' });
    }
    return new Promise<void>((resolve, reject) => {
      if (this.writer) {
        this.writer.write(Buffer.concat([tx.transaction.serialize(), bufferSplit]), (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  }

  async rotate(all: Map<Address, WrappedTransaction[]>) {
    if (this.writer) {
      await new Promise((r) => {
        this.writer!.end(r);
      });
      this.writer = undefined;
    }
    let output = fs.createWriteStream(this.path + '.new');
    let journaled = 0;
    let key: Address;
    let val: WrappedTransaction[];
    let array: Promise<any>[] = [];
    for ([key, val] of all) {
      for (let tx of val) {
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
      await new Promise((r) => {
        output.end(r);
      });
      return;
    }
    await new Promise((r) => {
      output.end(r);
    });

    fs.renameSync(this.path + '.new', this.path);
    this.writer = fs.createWriteStream(this.path, { flags: 'a' });
    console.log('Regenerated local transaction journal', 'transactions', journaled, 'accounts', Array.from(all.keys()).length);
  }

  async close() {
    if (this.writer) {
      await new Promise((r) => {
        this.writer!.end(r);
      });
      this.writer = undefined;
    }
    return;
  }
}
