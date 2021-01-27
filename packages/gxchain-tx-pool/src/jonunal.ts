import * as fs from 'fs';
import { Transaction } from '@gxchain2/tx';
import { Address, rlp } from 'ethereumjs-util';
import readline from 'readline';

export class jonunal {
  path: string;
  writer: fs.WriteStream;
  constructor(path: string) {
    this.path = path;
    this.writer = new fs.WriteStream();
  }

  async load(add: (transaction: Transaction) => void) {
    try {
      fs.existsSync(this.path);
    } catch (err) {
      return err;
    }
    try {
      var inputer = fs.createReadStream(this.path);
    } catch (err) {
      return err;
    }

    inputer.on('end', () => {
      console.log('end');
    });
    let Readline = readline.createInterface({
      input: inputer
    });
    this.writer = fs.createWriteStream('');

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

    let failure: any;
    let batch: Transaction[] = [];
    for await (const line of Readline) {
      let tx: Transaction = batch[0];
      try {
        tx = Transaction.fromRlpSerializedTx(Buffer.from(line));
      } catch (err) {
        failure = err;
      }

      total++;
      if (batch.push(tx) > 1024) {
        loadBath(batch);
        batch = [];
      }
    }
    console.log('Loaded local transaction journal', 'transactions', total, 'dropped', dropped);
    return failure;
  }

  insert(tx: Transaction) {
    if (this.writer == null) {
      return new Error('no active journal');
    }
    try {
      this.writer.write(rlp.encode(Buffer.from(tx.toString)));
      this.writer.end();
    } catch (err) {
      return err;
    }
  }

  rotate(all: Map<Address, Transaction[]>) {
    if (this.writer != null) {
      return null;
    }
    let output: fs.WriteStream;
    try {
      output = fs.createWriteStream(this.path + '.new');
    } catch (err) {
      return err;
    }
    let journaled = 0;
    all.forEach(function (val, key) {
      for (let tx of val) {
        try {
          let valbuffer = tx.serialize;
          output.write(valbuffer + '\r\n');
        } catch (err) {
          output.end();
          return err;
        }
      }
      journaled += val.length;
    });
    output.end();

    try {
      fs.renameSync(this.path + '.new', this.path);
    } catch (err) {
      return err;
    }
    try {
      this.writer = fs.createWriteStream(this.path);
    } catch (err) {
      return err;
    }
    console.log('Regenerated local transaction journal', 'transactions', journaled, 'accounts', all.keys.length);
    return null;
  }

  close() {
    this.writer == null;
    return;
  }
}
