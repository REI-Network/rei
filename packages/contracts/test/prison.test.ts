import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';
import { upTimestamp, toBN } from './utils';

declare var artifacts: any;
declare var web3: Web3;

const Config = artifacts.require('Config_devnet');
const Jail = artifacts.require('Prison');

class RecordQueue {
  missRecords: (string | number)[][][] = [];
  public queueLength: number;
  miners: string[] = [];

  constructor(queueLength: number) {
    this.queueLength = queueLength;
  }

  push(record: (string | number)[][]) {
    this.missRecords.push(record);
    record.map((item) => {
      if (this.miners.indexOf(item[0] as string) === -1) {
        this.miners.push(item[0] as string);
      }
    });
    if (this.missRecords.length > this.queueLength) {
      this.missRecords.shift();
    }
  }

  jail(address: string) {
    this.missRecords.map((record) => {
      record.map((item) => {
        if (item[0] === address) {
          item[1] = 0;
        }
      });
    });
  }

  getMissRecordsNumber(address: string) {
    let missNumber = 0;
    this.missRecords.map((record) => {
      record.map((item) => {
        if (item[0] === address) {
          missNumber += item[1] as number;
        }
      });
    });
    return missNumber;
  }

  resetQueueLength(newLength: number) {
    this.queueLength = newLength;
    this.drop();
  }

  drop() {
    while (this.missRecords.length > this.queueLength) {
      this.missRecords.shift();
    }
  }
}

async function checkMissRecord(queue: RecordQueue, prison: any) {
  expect(await prison.methods.getMinersLength().call(), 'Miners length should be equal').to.equal(queue.miners.length.toString());
  for (let i = 0; i < queue.miners.length; i++) {
    const miner = queue.miners[i];
    const missNumber = queue.getMissRecordsNumber(miner);
    const minerState = await prison.methods.miners(miner).call();
    expect(minerState.miner, 'Miner address should be equal').to.equal(miner);
    expect(minerState.missedRoundNumberPeriod, 'Missed round number this block should be equal').to.equal(missNumber.toString());
  }
}

describe('Prison', () => {
  let config: any;
  let prison: any;
  let deployer: any;
  let user1: any;
  let recordAmountPeriod: number;
  let recordQueue: RecordQueue;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();

    prison = new web3.eth.Contract(Jail.abi, (await Jail.new(config.options.address)).address, { from: deployer });
    await config.methods.setJail(prison.options.address).send();

    recordAmountPeriod = 3;
    recordQueue = new RecordQueue(recordAmountPeriod);
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
  });

  it('add missRecord scucessfully', async () => {
    const missedRecord1 = [[deployer, 10]];
    await prison.methods.addMissRecord(missedRecord1).send();
    recordQueue.push(missedRecord1);
    await checkMissRecord(recordQueue, prison);
    const missedRecord2 = [
      [deployer, 5],
      [user1, 5]
    ];
    await prison.methods.addMissRecord(missedRecord2).send();
    recordQueue.push(missedRecord2);
    await checkMissRecord(recordQueue, prison);

    const missedRecord3 = [
      [deployer, 5],
      [user1, 5]
    ];
    await prison.methods.addMissRecord(missedRecord3).send();
    recordQueue.push(missedRecord3);
    await checkMissRecord(recordQueue, prison);

    const missedRecord4 = [];
    await prison.methods.addMissRecord(missedRecord4).send();
    recordQueue.push(missedRecord4);
    await checkMissRecord(recordQueue, prison);
  });

  it('should jail miner successfully', async () => {
    await prison.methods.jail(deployer).send();
    recordQueue.jail(deployer);
    await checkMissRecord(recordQueue, prison);
    expect((await prison.methods.miners(deployer).call()).jailed, 'Miner should be jailed').be.equal(true);
  });

  it('should jail miner failed', async () => {
    try {
      await prison.methods.jail(deployer).send();
      recordQueue.push([]);
      await checkMissRecord(recordQueue, prison);
      assert.fail('Can not jail jailed miner');
    } catch (err) {}
  });

  it("should add jailed miner's missed record failed", async () => {
    try {
      const missedRecord5 = [[deployer, 5]];
      await prison.methods.addMissRecord(missedRecord5).send();
      recordQueue.push([]);
      await checkMissRecord(recordQueue, prison);
      assert.fail('Can not add jailed miner missed record');
    } catch (err) {}
  });

  it('should unjail miner successfully', async () => {
    await prison.methods.unjail().send();
    recordQueue.push([]);
    expect((await prison.methods.miners(deployer).call()).jailed, 'Miner should be unjailed').be.equal(false);
  });

  it('should unjail miner failed', async () => {
    try {
      await prison.methods.unjail().send();
      recordQueue.push([]);
      await checkMissRecord(recordQueue, prison);
      assert.fail('Can not unjail unjailed miner');
    } catch (err) {}
  });

  it('should get miner message successfully', async () => {
    const missedRecord6 = [
      [deployer, 15],
      [user1, 5]
    ];
    await prison.methods.addMissRecord(missedRecord6).send();
    recordQueue.push(missedRecord6);
    await checkMissRecord(recordQueue, prison);
    const deployerAddress = await prison.methods.getMinerAddressByIndex(0).call();
    expect(deployerAddress, 'Miner address should be equal').to.equal(deployer.toString());
    const minerGetByIndex = await prison.methods.getMinerByIndex(0).call();
    expect(minerGetByIndex.miner, 'Miner address should be equal').to.equal(deployer.toString());
    expect(minerGetByIndex.missedRoundNumberPeriod, 'Missed round number this block should be equal').to.equal(recordQueue.getMissRecordsNumber(deployer).toString());
    const missedRoundNumberPeriodByIndex = await prison.methods.getMissedRoundNumberPeriodByIndex(0).call();
    expect(missedRoundNumberPeriodByIndex, 'Missed round number this block should be equal').to.equal(recordQueue.getMissRecordsNumber(deployer).toString());
  });

  it('should run correctly after enlarged record amount period', async () => {
    const missedRecord7 = [
      [deployer, 7],
      [user1, 8]
    ];
    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.methods.addMissRecord(missedRecord7).send();
      recordQueue.push(missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
    recordAmountPeriod = 5;
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetQueueLength(recordAmountPeriod);
    recordQueue.push([]);
    await checkMissRecord(recordQueue, prison);

    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.methods.addMissRecord(missedRecord7).send();
      recordQueue.push(missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
  });

  it('should run correctly after narrowed record amount period', async () => {
    recordAmountPeriod = 2;
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetQueueLength(recordAmountPeriod);
    recordQueue.push([]);
    const missedRecord8 = [
      [deployer, 8],
      [user1, 7]
    ];
    await prison.methods.addMissRecord(missedRecord8).send();
    recordQueue.push(missedRecord8);
    await checkMissRecord(recordQueue, prison);
  });
});
