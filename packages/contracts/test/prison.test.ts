import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';

declare var artifacts: any;
declare var web3: Web3;

const Config = artifacts.require('Config_devnet');
const Prison = artifacts.require('Prison');

type MissRecord = [string, number];
type Miner = {
  jailed: boolean;
  address: string;
  missedRoundNumberPeriod: number;
  unjailedBlockNumber: number;
};

class RecordQueue {
  lowestRecordBlockNumber: number = 0;
  recordsAmountPeriod: number;
  jailThreshold: number;
  minerMap: Map<string, Miner> = new Map<string, Miner>();
  missRecords: Map<number, MissRecord[]> = new Map<number, MissRecord[]>();

  constructor(recordsAmountPeriod: number, jailThreshold: number) {
    this.recordsAmountPeriod = recordsAmountPeriod;
    this.jailThreshold = jailThreshold;
  }

  push(blockNumber: number, record: MissRecord[]) {
    if (blockNumber >= this.recordsAmountPeriod) {
      const blockNumberToDelete = blockNumber - this.recordsAmountPeriod;
      for (let i = this.lowestRecordBlockNumber; i <= blockNumberToDelete; i++) {
        const missRecord = this.missRecords.get(i);
        if (missRecord) {
          for (let j = 0; j < missRecord.length; j++) {
            const miner = this.minerMap.get(missRecord[j][0])!;
            if (miner.unjailedBlockNumber > i || miner.jailed) {
              continue;
            } else {
              miner.missedRoundNumberPeriod -= missRecord[j][1];
            }
          }
        }
        this.missRecords.delete(i);
      }
      this.lowestRecordBlockNumber = blockNumberToDelete + 1;
    }
    this.missRecords.set(blockNumber, record);
    record.forEach((item) => {
      const miner = this.minerMap.get(item[0]);
      if (!miner) {
        this.minerMap.set(item[0], {
          jailed: false,
          address: item[0],
          missedRoundNumberPeriod: item[1],
          unjailedBlockNumber: 0
        });
      } else if (!miner.jailed) {
        miner.missedRoundNumberPeriod += item[1];
        if (miner.missedRoundNumberPeriod >= this.jailThreshold) {
          miner.jailed = true;
          miner.missedRoundNumberPeriod = 0;
        }
      }
    });
  }

  getMissRecordsNumber(address: string) {
    return this.minerMap.get(address)?.missedRoundNumberPeriod || 0;
  }

  resetRecordsAmountPeriod(newLength: number) {
    this.recordsAmountPeriod = newLength;
  }

  unjail(blockNumber: number, address: string) {
    const miner = this.minerMap.get(address);
    if (miner) {
      miner.jailed = false;
      miner.unjailedBlockNumber = blockNumber;
    }
  }
}

async function checkMissRecord(queue: RecordQueue, prison: any) {
  const minerAddressArray = Array.from(queue.minerMap.keys());
  for (let i = 0; i < minerAddressArray.length; i++) {
    const minerAddress = minerAddressArray[i];
    const miner = queue.minerMap.get(minerAddress)!;
    const minerState = await prison.methods.miners(minerAddress).call();
    expect(minerState.miner, 'Miner address should be equal').to.equal(minerAddress);
    expect(minerState.missedRoundNumberPeriod, 'Missed round number this block should be equal').to.equal(miner.missedRoundNumberPeriod.toString());
    expect(minerState.jailed, 'Jailed state should be equal').to.equal(miner.jailed);
    expect(minerState.unjailedBlockNumber, 'Unjailed block number should be equal').to.equal(miner.unjailedBlockNumber.toString());
  }
}

describe('Prison', () => {
  let config: any;
  let prison: any;
  let deployer: any;
  let user1: any;
  let recordAmountPeriod: number;
  let recordQueue: RecordQueue;
  let missedRecordSkip: MissRecord[];

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
    missedRecordSkip = [
      [deployer, 1],
      [user1, 1]
    ];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();
    await config.methods.setStakeManager(deployer).send();

    prison = new web3.eth.Contract(Prison.abi, (await Prison.new(config.options.address)).address, { from: deployer });
    await config.methods.setJail(prison.options.address).send();

    recordAmountPeriod = 3;
    const jailThreshold = await config.methods.jailThreshold().call();
    recordQueue = new RecordQueue(recordAmountPeriod, jailThreshold);
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
  });

  it('add missRecord scucessfully', async () => {
    const missedRecord1: MissRecord[] = [[deployer, 1]];
    await prison.methods.addMissRecord(missedRecord1).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord1);
    await checkMissRecord(recordQueue, prison);

    const missedRecord2: MissRecord[] = [
      [deployer, 2],
      [user1, 2]
    ];
    await prison.methods.addMissRecord(missedRecord2).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord2);
    await checkMissRecord(recordQueue, prison);

    const missedRecord3: MissRecord[] = [
      [deployer, 3],
      [user1, 3]
    ];
    await prison.methods.addMissRecord(missedRecord3).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord3);
    await checkMissRecord(recordQueue, prison);

    const missedRecord4 = [];
    await prison.methods.addMissRecord(missedRecord4).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord4);
    await checkMissRecord(recordQueue, prison);
  });

  it('should jail miner sucessfully', async () => {
    const jailedState = (await prison.methods.miners(deployer).call()).jailed;
    expect(jailedState, 'Jailed state should be false').to.equal(false);
    const missedRecord5: MissRecord[] = [
      [deployer, 7],
      [user1, 3]
    ];
    await prison.methods.addMissRecord(missedRecord5).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord5);
    await checkMissRecord(recordQueue, prison);
    const jailedStateAfter = (await prison.methods.miners(deployer).call()).jailed;
    expect(jailedStateAfter, 'Jailed state should be true').to.equal(true);
  });

  it('should unjail miner failed', async () => {
    let failed = false;
    const forfeitAmount = await config.methods.forfeit().call();
    const deployerJailed = (await prison.methods.miners(deployer).call()).jailed;
    const user1Jailed = (await prison.methods.miners(user1).call()).jailed;
    expect(deployerJailed, 'Jailed state should be true').to.equal(true);
    expect(user1Jailed, 'Jailed state should be false').to.equal(false);

    try {
      await prison.methods.unjail(deployer).send({ value: new BN(forfeitAmount).subn(1) });
      failed = true;
    } catch (err) {}
    await checkMissRecord(recordQueue, prison);

    await config.methods.setStakeManager(user1).send();
    await checkMissRecord(recordQueue, prison);

    try {
      await prison.methods.unjail(user1).send({ value: forfeitAmount, from: user1 });
      failed = true;
    } catch (err) {}
    await checkMissRecord(recordQueue, prison);

    if (failed) {
      assert.fail('Unjail should failed');
    }

    await config.methods.setStakeManager(deployer).send();
    await checkMissRecord(recordQueue, prison);
  });

  it('should unjail miner successfully', async () => {
    expect((await web3.eth.getBalance(prison.options.address)).toString(), 'Prison balance should be zero').to.equal('0');
    const forfeitAmount = await config.methods.forfeit().call();
    await prison.methods.unjail(deployer).send({ value: forfeitAmount });
    recordQueue.unjail(await web3.eth.getBlockNumber(), deployer);
    expect((await prison.methods.miners(deployer).call()).jailed, 'Miner should be unjailed').be.equal(false);
    expect((await web3.eth.getBalance(prison.options.address)).toString(), 'Prison balance should be equal').to.equal(forfeitAmount);
    await prison.methods.addMissRecord(missedRecordSkip).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecordSkip);
    await checkMissRecord(recordQueue, prison);
  });

  it('should run correctly after enlarged record amount period', async () => {
    const missedRecord7: MissRecord[] = [
      [deployer, 1],
      [user1, 2]
    ];
    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.methods.addMissRecord(missedRecord7).send();
      recordQueue.push(await web3.eth.getBlockNumber(), missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
    recordAmountPeriod = 5;
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetRecordsAmountPeriod(recordAmountPeriod);
    await checkMissRecord(recordQueue, prison);

    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.methods.addMissRecord(missedRecord7).send();
      recordQueue.push(await web3.eth.getBlockNumber(), missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
  });

  it('should run correctly after narrowed record amount period', async () => {
    recordAmountPeriod = 2;
    await config.methods.setRecordsAmountPeriod(recordAmountPeriod).send();
    expect(await config.methods.recordsAmountPeriod().call(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetRecordsAmountPeriod(recordAmountPeriod);
    const missedRecord8: MissRecord[] = [
      [deployer, 8],
      [user1, 7]
    ];
    await prison.methods.addMissRecord(missedRecord8).send();
    recordQueue.push(await web3.eth.getBlockNumber(), missedRecord8);
    await checkMissRecord(recordQueue, prison);
  });
});
