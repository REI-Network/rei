import * as fs from 'fs';
import { Transaction } from '@gxchain2/tx';
import { Address, rlp } from 'ethereumjs-util';
import readline from 'readline';
import { EventEmitter } from 'events';
import stream from 'stream';

export class jonunal extends EventEmitter {
  path: string;
  writer: fs.WriteStream;
  constructor(path: string) {
    super();
    this.path = path;
    this.writer = fs.createWriteStream(this.path);
  }

  async load(add: (transaction: Transaction) => void) {
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

    let buffersplit = Buffer.from('\r\n');
    let bufferinput: Buffer = Buffer.from('');
    inputer.on('data', (chunk: Buffer) => {
      try {
        bufferinput = Buffer.concat([bufferinput, chunk]);
        let start = 0;
        let end = bufferinput.length;
        while (start < end) {
          let i = bufferinput.indexOf(buffersplit);
          if (i == -1) {
            break;
          }
          let tx = Transaction.fromRlpSerializedTx(bufferinput.slice());
        }
        total++;
        if (batch.push(tx) > 1024) {
          loadBath(batch);
          batch = [];
        }
      } catch (err) {
        this.emit('error', err);
      }
    });
    // for await (const line of Readline) {
    //   let tx: Transaction = batch[0];
    //   try {
    //     tx = Transaction.fromRlpSerializedTx(Buffer.from(line));
    //   } catch (err) {
    //     this.emit('error', err);
    //   }

    //   total++;
    //   if (batch.push(tx) > 1024) {
    //     loadBath(batch);
    //     batch = [];
    //   }
    // }
    console.log('Loaded local transaction journal', 'transactions', total, 'dropped', dropped);
  }

  insert(tx: Transaction) {
    if (this.writer == undefined) {
      return new Error('no active journal');
    }
    try {
      this.writer = fs.createWriteStream(this.path);
      this.writer.write(tx.serialize());
      this.writer.write(Buffer.from('\r\n'));
      this.writer.end();
    } catch (err) {
      this.emit('error', err);
    }
  }

  rotate(all: Map<Address, Transaction[]>) {
    if (this.writer != undefined) {
      return;
    }
    let output = new fs.WriteStream();
    try {
      output = fs.createWriteStream(this.path + '.new');
    } catch (err) {
      this.emit('error', err);
    }
    let journaled = 0;
    all.forEach((val, key) => {
      for (let tx of val) {
        try {
          let valbuffer = tx.serialize();
          output.write(tx);
          output.write('\r\n');
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
    this.writer == null;
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
txjonunal.insert(unsignedTx3);
txjonunal.insert(unsignedTx2);
//txjonunal.insert(unsignedTx1);
txjonunal.load(function (num) {
  console.log(num);
});
