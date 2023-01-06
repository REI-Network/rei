import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { ethers } from 'hardhat';
import { Contract, ContractFactory, Signer } from 'ethers';

type MissRecord = [string, number];
type Miner = {
  jailed: boolean;
  address: string;
  missedRoundNumberPeriod: number;
  lastUnjailedBlockNumber: number;
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

  resetJailThreshold(newThreshold: number) {
    this.jailThreshold = newThreshold;
  }

  push(blockNumber: number, record: MissRecord[]) {
    if (blockNumber >= this.recordsAmountPeriod) {
      const blockNumberToDelete = blockNumber - this.recordsAmountPeriod;
      for (let i = this.lowestRecordBlockNumber; i <= blockNumberToDelete; i++) {
        const missRecord = this.missRecords.get(i);
        if (missRecord) {
          for (let j = 0; j < missRecord.length; j++) {
            const miner = this.minerMap.get(missRecord[j][0])!;
            if (miner.lastUnjailedBlockNumber > i || miner.jailed) {
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
          lastUnjailedBlockNumber: 0
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
      miner.lastUnjailedBlockNumber = blockNumber;
    }
  }
}

async function checkMissRecord(queue: RecordQueue, prison: Contract) {
  const minerAddressArray = Array.from(queue.minerMap.keys());
  for (let i = 0; i < minerAddressArray.length; i++) {
    const minerAddress = minerAddressArray[i];
    const miner = queue.minerMap.get(minerAddress)!;
    const minerState = await prison.miners(minerAddress);
    expect(minerState.miner, 'Miner address should be equal').to.equal(minerAddress);
    expect(minerState.missedRoundNumberPeriod, 'Missed round number this block should be equal').to.equal(miner.missedRoundNumberPeriod.toString());
    expect(minerState.jailed, 'Jailed state should be equal').to.equal(miner.jailed);
    expect(minerState.lastUnjailedBlockNumber, 'Unjailed block number should be equal').to.equal(miner.lastUnjailedBlockNumber.toString());
  }
}

describe('Prison', () => {
  let config: Contract;
  let prison: Contract;
  let deployer: Signer;
  let user1: Signer;
  let deployerAddr: string;
  let user1Addr: string;
  let recordAmountPeriod: number;
  let recordQueue: RecordQueue;
  let missedRecordSkip: MissRecord[];

  let prisonFactory: ContractFactory;
  let configFactory: ContractFactory;

  before(async () => {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    user1 = accounts[1];
    deployerAddr = await deployer.getAddress();
    user1Addr = await user1.getAddress();
    prisonFactory = await ethers.getContractFactory('Prison');
    configFactory = await ethers.getContractFactory('Config_devnet');
    missedRecordSkip = [
      [deployerAddr, 0],
      [user1Addr, 0]
    ];
  });

  it('should deploy succeed', async () => {
    // Update block number
    for (let i = 0; i < 10; i++) {
      await deployer.sendTransaction({
        to: user1Addr,
        value: ethers.utils.parseEther('1')
      });
    }
    config = await configFactory.connect(deployer).deploy();
    await config.setSystemCaller(deployerAddr);
    await config.setStakeManager(deployerAddr);
    await config.setJailThreshold(10);

    prison = await prisonFactory.connect(deployer).deploy(config.address);
    const lowestRecordBlockNumber = await prison.lowestRecordBlockNumber();
    expect(lowestRecordBlockNumber, 'Lowest record block number should be equal').to.equal((await ethers.provider.getBlockNumber()).toString());
    recordAmountPeriod = 3;
    await config.setRecordsAmountPeriod(recordAmountPeriod);

    const missedRecord: MissRecord[] = [];
    const checkTimes = 10;
    for (let i = 0; i < recordAmountPeriod - 1 + checkTimes; i++) {
      await prison.addMissRecord(missedRecord);
      const oldLowestRecordBlockNumber = await prison.lowestRecordBlockNumber({ blockTag: (await ethers.provider.getBlockNumber()) - 1 });
      const newLowestRecordBlockNumber = (await ethers.provider.getBlockNumber()) - 1 - recordAmountPeriod + 1;
      const lowestRecordBlockNumberExpect = newLowestRecordBlockNumber > oldLowestRecordBlockNumber ? newLowestRecordBlockNumber : oldLowestRecordBlockNumber.toNumber();
      expect(lowestRecordBlockNumberExpect, 'Lowest record block number should be equal').to.equal((await prison.lowestRecordBlockNumber()).toNumber());
    }

    const jailThreshold = await config.jailThreshold();
    recordQueue = new RecordQueue(recordAmountPeriod, jailThreshold);
    expect(await config.recordsAmountPeriod(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
  });

  it('add missRecord scucessfully', async () => {
    const missedRecord1: MissRecord[] = [[deployerAddr, 1]];
    await prison.addMissRecord(missedRecord1);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord1);
    await checkMissRecord(recordQueue, prison);

    const missedRecord2: MissRecord[] = [
      [deployerAddr, 2],
      [user1Addr, 2]
    ];
    await prison.addMissRecord(missedRecord2);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord2);
    await checkMissRecord(recordQueue, prison);

    const missedRecord3: MissRecord[] = [
      [deployerAddr, 3],
      [user1Addr, 3]
    ];
    await prison.addMissRecord(missedRecord3);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord3);
    await checkMissRecord(recordQueue, prison);

    const missedRecord4 = [];
    await prison.addMissRecord(missedRecord4);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord4);
    await checkMissRecord(recordQueue, prison);
  });

  it('should jail miner sucessfully', async () => {
    const jailedState = (await prison.miners(deployerAddr)).jailed;
    expect(jailedState, 'Jailed state should be false').to.equal(false);
    const missedRecord5: MissRecord[] = [
      [deployerAddr, 7],
      [user1Addr, 3]
    ];
    await prison.addMissRecord(missedRecord5);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord5);
    await checkMissRecord(recordQueue, prison);
    const jailedStateAfter = (await prison.miners(deployerAddr)).jailed;
    expect(jailedStateAfter, 'Jailed state should be true').to.equal(true);
    const blockNumberTofind = (await ethers.provider.getBlockNumber()) - 1;
    const jailedMinerLength = await prison.getJaiedMinersLengthByBlockNumber(blockNumberTofind);
    expect(jailedMinerLength, 'Jailed miner length should be 1').to.equal('1');
    const jailedMiner = await prison.jailedRecords(blockNumberTofind, 0);
    expect(jailedMiner, 'Jailed miner should be equal').to.equal(deployerAddr);
  });

  it('should unjail miner failed', async () => {
    let failed = false;
    const forfeitAmount = await config.forfeit();
    const deployerJailed = (await prison.miners(deployerAddr)).jailed;
    const user1Jailed = (await prison.miners(user1Addr)).jailed;
    expect(deployerJailed, 'Jailed state should be true').to.equal(true);
    expect(user1Jailed, 'Jailed state should be false').to.equal(false);

    try {
      await prison.unjail(deployerAddr, { value: new BN(forfeitAmount).subn(1) });
      failed = true;
    } catch (err) {}
    if (failed) {
      assert.fail('Unjail should failed');
    }
    await checkMissRecord(recordQueue, prison);

    try {
      await prison.unjail(user1, { value: forfeitAmount });
      failed = true;
    } catch (err) {}
    if (failed) {
      assert.fail('Unjail should failed');
    }
    await checkMissRecord(recordQueue, prison);
  });

  it('should get jialed miners successfully', async () => {
    const miner = await prison.miners(deployerAddr);
    const jailedMinerAmount = await prison.getJailedMinersLength();
    expect(jailedMinerAmount, 'Jailed miner amount should be equal').to.equal('1');
    const jailedAddress1 = await prison.getJailedMinersById(miner.id);
    const jailedAddress2 = await prison.getJailedMinersByIndex(0);
    expect(jailedAddress1, 'jailed miner address1 should be equal').equal(deployerAddr);
    expect(jailedAddress2, 'jailed miner address2 should be equal').equal(deployerAddr);
  });

  it('should unjail miner successfully', async () => {
    expect((await ethers.provider.getBalance(prison.address)).toString(), 'Prison balance should be zero').to.equal('0');
    const forfeitAmount = await config.forfeit();
    await prison.unjail(deployerAddr, { value: forfeitAmount });
    recordQueue.unjail(await ethers.provider.getBlockNumber(), deployerAddr);
    expect((await prison.miners(deployerAddr)).jailed, 'Miner should be unjailed').be.equal(false);
    expect((await ethers.provider.getBalance(prison.address)).toString(), 'Prison balance should be equal').to.equal(forfeitAmount);
    await prison.addMissRecord(missedRecordSkip);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecordSkip);
    await checkMissRecord(recordQueue, prison);
  });

  it('should reduce miss record successfully with blocks gone', async () => {
    const missedRecordNew: MissRecord[] = [
      [deployerAddr, 2],
      [user1Addr, 1]
    ];
    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.addMissRecord(missedRecordNew);
      recordQueue.push(await ethers.provider.getBlockNumber(), missedRecordNew);
      await checkMissRecord(recordQueue, prison);
    }
    const deployerMissedNumber = (await prison.miners(deployerAddr)).missedRoundNumberPeriod;
    const user1MissedNumber = (await prison.miners(user1Addr)).missedRoundNumberPeriod;
    expect(deployerMissedNumber, 'Missed number should be equal').to.equal((2 * recordAmountPeriod).toString());
    expect(user1MissedNumber, 'Missed number should be equal').to.equal((1 * recordAmountPeriod).toString());
    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.addMissRecord(missedRecordSkip);
      recordQueue.push(await ethers.provider.getBlockNumber(), missedRecordSkip);
      await checkMissRecord(recordQueue, prison);
      expect((await prison.miners(deployerAddr)).missedRoundNumberPeriod, 'Missed number should be equal').to.equal((deployerMissedNumber - 2 * (i + 1)).toString());
      expect((await prison.miners(user1Addr)).missedRoundNumberPeriod, 'Missed number should be equal').to.equal((user1MissedNumber - 1 * (i + 1)).toString());
    }
  });

  it('should run correctly after enlarged record amount period', async () => {
    const missedRecord7: MissRecord[] = [
      [deployerAddr, 1],
      [user1Addr, 2]
    ];
    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.addMissRecord(missedRecord7);
      recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
    recordAmountPeriod = 5;
    await config.setRecordsAmountPeriod(recordAmountPeriod);
    expect(await config.recordsAmountPeriod(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetRecordsAmountPeriod(recordAmountPeriod);
    await checkMissRecord(recordQueue, prison);

    for (let i = 0; i < recordAmountPeriod; i++) {
      await prison.addMissRecord(missedRecord7);
      recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord7);
      await checkMissRecord(recordQueue, prison);
    }
  });

  it('should run correctly after narrowed record amount period', async () => {
    recordAmountPeriod = 2;
    await config.setRecordsAmountPeriod(recordAmountPeriod);
    expect(await config.recordsAmountPeriod(), 'Record amount period should be equal').to.equal(recordAmountPeriod.toString());
    recordQueue.resetRecordsAmountPeriod(recordAmountPeriod);
    const missedRecord8: MissRecord[] = [
      [deployerAddr, 8],
      [user1Addr, 7]
    ];
    await prison.addMissRecord(missedRecord8);
    recordQueue.push(await ethers.provider.getBlockNumber(), missedRecord8);
    await checkMissRecord(recordQueue, prison);
  });
});
