import fs from 'fs';
import { Transaction } from '@gxchain2/tx';
import { Address } from 'ethereumjs-util';

const bufferSplit = Buffer.from('\r\n');

export class Jonunal {
  path: string;
  writer?: fs.WriteStream;
  constructor(path: string) {
    this.path = path;
    this.writer = fs.createWriteStream(this.path, { flags: 'a' });
  }

  async load(add: (transaction: Transaction) => void) {
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

      const loadBath = (txs: Transaction[]) => {
        txs.forEach((tx) => {
          try {
            add(tx);
          } catch (err) {
            dropped++;
          }
        });
      };

      let batch: Transaction[] = [];
      let bufferInput: Buffer = Buffer.from('');
      inputer.on('data', (chunk: Buffer) => {
        bufferInput = Buffer.concat([bufferInput, chunk]);
        while (true) {
          let i = bufferInput.indexOf(bufferSplit);
          if (i == -1) {
            break;
          }
          let bufferTemp = Buffer.from(bufferInput);
          const tx = Transaction.fromRlpSerializedTx(bufferTemp.slice(0, i));
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

  insert(tx: Transaction) {
    if (!this.writer) {
      throw new Error('no active journal');
    }
    return new Promise<void>((resolve, reject) => {
      if (this.writer) {
        this.writer.write(Buffer.concat([tx.serialize(), bufferSplit]), (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  }

  async rotate(all: Map<Address, Transaction[]>) {
    if (this.writer) {
      await new Promise((r) => {
        this.writer!.end(r);
      });
      this.writer = undefined;
    }
    let output = fs.createWriteStream(this.path + '.new');
    let journaled = 0;
    let key: Address;
    let val: Transaction[];
    let array: Promise<any>[] = [];
    for ([key, val] of all) {
      for (let tx of val) {
        array.push(
          new Promise<void>((resolve, reject) => {
            output.write(Buffer.concat([tx.serialize(), bufferSplit]), (err) => {
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
