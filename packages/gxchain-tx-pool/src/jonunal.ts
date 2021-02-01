import * as fs from 'fs';
import { Transaction } from '@gxchain2/tx';
import { Address, rlp } from 'ethereumjs-util';
import readline from 'readline';
import { EventEmitter } from 'events';
import stream from 'stream';
import { resolve } from 'path';
import { rejects } from 'assert';

export class jonunal extends EventEmitter {
  path: string;
  writer: fs.WriteStream;
  constructor(path: string) {
    super();
    this.path = path;
    this.writer = fs.createWriteStream(this.path);
  }

  load(add: (transaction: Transaction) => void) {
    try {
      fs.existsSync(this.path);
    } catch (err) {
      this.emit('error', err);
    }

    try {
      var inputer = fs.createReadStream(this.path);
    } catch (err) {
      this.emit('error', err);
    }
    var inputer = fs.createReadStream(this.path);
    this.writer.close;

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

    let bufferSplit = Buffer.from('\r\n');
    let bufferInput: Buffer = Buffer.from('');
    inputer.on('data', (chunk: Buffer) => {
      try {
        bufferInput = Buffer.concat([bufferInput, chunk]);
        let end = bufferInput.length;
        while (true) {
          let i = bufferInput.indexOf(bufferSplit);
          if (i == -1) {
            break;
          }
          let bufferTemp = Buffer.from(bufferInput);
          try {
            let tx = Transaction.fromRlpSerializedTx(bufferTemp.slice(0, i));
            total++;
            console.log(total);
            console.log(tx);
            if (batch.push(tx) > 1024) {
              loadBath(batch);
              batch = [];
            }
            //console.log(batch);
          } catch (err) {
            break;
          }
          bufferInput = bufferInput.slice(i + bufferSplit.length);
        }
        resolve();
      } catch (err) {
        this.emit('error', err);
      }
    });

    inputer.on('end', function () {
      console.log('Loaded local transaction journal', 'transactions', total, 'dropped', dropped);
    });
  }

  insert(tx: Transaction) {
    if (!this.writer) {
      throw new Error('no active journal');
    }
    return new Promise<void>((resolve) => {
      this.writer.write(Buffer.concat([tx.serialize(), Buffer.from('\r\n')]), (err) => {
        if (err) {
          rejects;
        }
        resolve();
      });
    });
  }

  rotate(all: Map<Address, Transaction[]>) {
    if (this.writer) {
      this.writer.close();
    }
    try {
      let output = fs.createWriteStream(this.path + '.new');
    } catch (err) {
      this.emit('error', err);
    }
    let output = fs.createWriteStream(this.path + '.new');
    let journaled = 0;
    all.forEach((val, key) => {
      for (let tx of val) {
        try {
          output.write(Buffer.concat([tx.serialize(), Buffer.from('\r\n')]), (err) => {
            if (err) {
              console.log(err);
            }
          });
        } catch (err) {
          output.end();
          this.emit('error', err);
        }
      }
      journaled += val.length;
    });
    output.end();

    try {
      fs.renameSync(this.path + '.new', this.path);
    } catch (err) {
      this.emit('error', err);
    }
    try {
      this.writer = fs.createWriteStream(this.path);
    } catch (err) {
      this.emit('error', err);
    }
    console.log('Regenerated local transaction journal', 'transactions', journaled, 'accounts', all.keys.length);
  }

  close() {
    this.writer.end();
    return;
  }
}

let txjonunal = new jonunal('/Users/bijianing/Desktop/jstest.txt');
const unsignedTx1 = Transaction.fromTxData(
  {
    gasLimit: '0x5208',
    gasPrice: '0x01',
    nonce: 1,
    to: '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b',
    value: '0x01'
  },
  { common: undefined }
);
const unsignedTx2 = Transaction.fromTxData(
  {
    gasLimit: '0x5209',
    gasPrice: '0x02',
    nonce: 2,
    to: '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b',
    value: '0x02'
  },
  { common: undefined }
);
const unsignedTx3 = Transaction.fromTxData(
  {
    gasLimit: '0x5210',
    gasPrice: '0x03',
    nonce: 3,
    to: '0x3289621709f5b35d09b4335e129907ac367a0593',
    value: '0x03'
  },
  { common: undefined }
);
let address1 = Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593');
let testmap = new Map([[address1, [unsignedTx1, unsignedTx2]]]);
//txjonunal.rotate(testmap);
//txjonunal.insert(unsignedTx3);
//txjonunal.insert(unsignedTx1);
txjonunal.rotate(testmap);
txjonunal.load(function (num) {
  console.log(num);
});
