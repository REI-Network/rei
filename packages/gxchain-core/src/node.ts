import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';
import type { RunBlockResult } from '@ethereumjs/vm/dist/runBlock';
import { Account, Address, setLengthLeft, rlp, toBuffer } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';

import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl, createLevelDB } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { CommonImpl } from '@gxchain2/common';
import { BlockchainImpl } from '@gxchain2/blockchain';
import { StateManagerImpl } from '@gxchain2/state-manager';
import { VMImpl } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

function createReceipt(tx, block, logs, gasUsed, cumulativeGasUsed, contractAddress, status, logsBloom) {
  var obj: any = {};
  obj.tx = tx;
  obj.block = block;
  obj.logs = logs;
  obj.gasUsed = gasUsed;
  obj.cumulativeGasUsed = cumulativeGasUsed;
  obj.contractAddress = contractAddress;
  obj.status = status;
  obj.logsBloom = logsBloom;

  obj.transactionIndex = 0;

  obj.txHash = tx.hash();

  for (var i = 0; i < block.transactions.length; i++) {
    var current = block.transactions[i];
    if (current.hash().equals(obj.txHash)) {
      obj.transactionIndex = i;
      break;
    }
  }
  return obj;
}

/*
class Receipt {
  tx;
  block;
  logs;
  gasUsed;
  cumulativeGasUsed;
  contractAddress;
  status;
  logsBloom;

  transactionIndex;

  txHash;
  constructor() {}
}
*/

export default class NodeImpl implements Node {
  readonly p2p: P2P;
  readonly db: Database;
  readonly common: CommonImpl;
  readonly chainDB: LevelUp;
  readonly accountDB: LevelUp;
  readonly databasePath: string;
  readonly stateManager: StateManagerImpl;
  readonly txPool: TransactionPool;

  blockchain!: BlockchainImpl;
  vm!: VMImpl;

  constructor(databasePath: string) {
    this.databasePath = databasePath[0] === '/' ? databasePath : path.join(__dirname, databasePath);
    this.p2p = new P2PImpl(this);
    this.common = new CommonImpl({ chain: 'mainnet', hardfork: 'chainstart' });
    this.chainDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    this.accountDB = createLevelDB(path.join(this.databasePath, 'accountdb'));
    this.db = new DatabaseImpl(this.chainDB, this.common);
    this.stateManager = new StateManagerImpl({ common: this.common, trie: new Trie(this.accountDB) });
    this.txPool = new TransactionPool();
  }

  async setupAccountInfo(accountInfo: any) {
    const stateManager = this.stateManager;
    await stateManager.checkpoint();

    for (const addr of Object.keys(accountInfo)) {
      const { nonce, balance, storage, code } = accountInfo[addr];

      const address = new Address(Buffer.from(addr.slice(2), 'hex'));
      const account = Account.fromAccountData({ nonce, balance });
      await stateManager.putAccount(address, account);

      for (const hexStorageKey of Object.keys(storage)) {
        const val = Buffer.from(storage[hexStorageKey], 'hex');
        const storageKey = setLengthLeft(Buffer.from(hexStorageKey, 'hex'), 32);

        await stateManager.putContractStorage(address, storageKey, val);
      }

      const codeBuf = Buffer.from(code.slice(2), 'hex');

      await stateManager.putContractCode(address, codeBuf);
    }

    await stateManager.commit();
  }

  async init() {
    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      console.log('find genesis block in db', '0x' + genesisHash.toString('hex'));
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      let genesisBlockJSON = JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesisBlock.json')).toString());
      console.log('read genesis block from file', genesisBlockJSON.hash);
      genesisBlock = Block.genesis({ header: genesisBlockJSON }, { common: this.common });

      await this.setupAccountInfo(JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesisAccount.json')).toString()));
    }

    BlockchainImpl.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new BlockchainImpl({
      db: this.chainDB,
      common: this.common,
      validateConsensus: false,
      validateBlocks: false,
      genesisBlock
    });
    this.vm = new VMImpl({
      common: this.common,
      stateManager: this.stateManager,
      blockchain: this.blockchain
    });

    await this.vm.init();
    const promises: Promise<RunBlockResult>[] = [];
    this.blockchain.iterator('vm', (block) => {
      promises.push(this.vm.runBlock({ block, generate: true, skipBlockValidation: true }));
    });
    await Promise.all(promises);

    await this.p2p.init();
  }

  async processBlock(block: Block) {
    var results = await this.vm
      .runBlock({
        block,
        generate: true,
        skipBlockValidation: true
      })
      .catch((vmerr) => ({ vmerr }));
    let vmerr = (results as { vmerr: any }).vmerr;
    // This is a check that has been in there for awhile. I'm unsure if it's required, but it can't hurt.
    if (vmerr && vmerr instanceof Error === false) {
      throw new Error('VM error: ' + vmerr);
    }
    results = results as RunBlockResult;

    // If no error, check for a runtime error. This can return null if no runtime error.
    // vmerr = RuntimeError.fromResults(block.transactions, results);

    // Note, even if we have an error, some transactions may still have succeeded.
    // Process their logs if so, returning the error at the end.

    var receipts: any[] = [];

    var totalBlockGasUsage = new BN(0);

    results.results.forEach(function (result) {
      totalBlockGasUsage = totalBlockGasUsage.add(result.gasUsed);
    });

    const txTrie = new Trie();
    const rcptTrie = new Trie();
    const promises: Promise<void>[] = [];
    const putInTrie = (trie: Trie, key: Buffer, val: Buffer) => trie.put.bind(trie)(key, val);

    for (var v = 0; v < results.receipts.length; v++) {
      var result = results.results[v];
      var receipt: any = results.receipts[v];
      var tx = block.transactions[v];
      // var txHash = tx.hash();
      var txLogs = [];

      const rcpt = createReceipt(tx, block, txLogs, result.gasUsed.toArrayLike(Buffer), receipt.gasUsed, result.createdAddress, receipt.status, '0x' + receipt.bitvector.toString('hex'));
      receipts.push(rcpt);

      const rawReceipt = [receipt.status, receipt.gasUsed, receipt.bitvector, receipt.logs];
      const rcptBuffer = rlp.encode(rawReceipt);
      const key = rlp.encode(v);
      promises.push(putInTrie(txTrie, key, tx.serialize()));
      promises.push(putInTrie(rcptTrie, key, rcptBuffer));
    }
    await Promise.all(promises);

    var newBlock = Block.fromBlockData(
      {
        header: {
          parentHash: block.header.parentHash,
          uncleHash: block.header.uncleHash,
          coinbase: block.header.coinbase,
          stateRoot: block.header.stateRoot,
          transactionsTrie: txTrie.root,
          receiptTrie: rcptTrie.root,
          bloom: block.header.bloom,
          difficulty: block.header.difficulty,
          number: block.header.number,
          gasLimit: block.header.gasLimit,
          gasUsed: totalBlockGasUsage,
          timestamp: block.header.timestamp,
          extraData: block.header.extraData,
          mixHash: block.header.mixHash,
          nonce: block.header.nonce
        },
        transactions: block.transactions
      },
      { common: block._common }
    );

    // Put that block on the end of the chain
    await this.blockchain.putBlock(newBlock);
  }
}
