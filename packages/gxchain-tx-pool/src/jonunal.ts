import fs from 'fs';
import { Transaction } from '@gxchain2/tx';
import { Address, rlp } from 'ethereumjs-util';
import readline from 'readline';
import { EventEmitter } from 'events';

const bufferSplit = Buffer.from('\r\n');

export class jonunal extends EventEmitter {
  path: string;
  writer?: fs.WriteStream;
  constructor(path: string) {
    super();
    this.path = path;
    this.writer = fs.createWriteStream(this.path, { flags: 'a' });
  }

  load(add: (transaction: Transaction) => void) {
    try {
      if (!fs.existsSync(this.path)) {
        fs.createWriteStream(this.path, { flags: 'a' });
      }
      var inputer = fs.createReadStream(this.path);
      if (this.writer) {
        this.writer.end();
        this.writer = undefined;
      }

      let total = 0;
      let dropped = 0;

      let loadBath = (txs: Transaction[]) => {
        txs.forEach(function (tx) {
          try {
            add(tx);
          } catch (err) {
            console.log('Failed to add journaled transaction', 'err', err);
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
          let tx = Transaction.fromRlpSerializedTx(bufferTemp.slice(0, i));
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

      inputer.on('end', function () {
        console.log('Loaded local transaction journal', 'transactions', total, 'dropped', dropped);
      });
    } catch (err) {
      this.emit(err);
    }
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
          }
          resolve();
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
    try {
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
                  console.log(err);
                }
                resolve();
              });
            })
          );
        }
        journaled += val.length;
      }
      await Promise.all(array).catch((err) => {
        this.emit(err);
      });
      output.end();

      fs.unlinkSync(this.path);
      fs.renameSync(this.path + '.new', this.path);
      this.writer = fs.createWriteStream(this.path, { flags: 'a' });
      console.log('Regenerated local transaction journal', 'transactions', journaled, 'accounts', Array.from(all.keys()).length);
    } catch (err) {
      console.log(err);
      this.emit(err);
    }
  }

  close() {
    if (this.writer) {
      this.writer.end();
      this.writer = undefined;
    }
    return;
  }
}
