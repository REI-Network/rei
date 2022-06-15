import { expect } from 'chai';
import { keccak256, rlp, bufferToInt, BN } from 'ethereumjs-util';
import { BaseTrie } from 'merkle-patricia-tree';
import { LeafNode } from 'merkle-patricia-tree/dist/trieNode';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database, DBDeleteSnapAccount, DBDeleteSnapStorage, DBSaveSerializedSnapAccount } from '@rei-network/database';
import { SnapTree, journalVersion } from '../../src/snap/snapTree';
import { AccountInfo, accountsToDiffLayer, genRandomAccounts, modifyRandomAccounts } from './util';
import { DiskLayer } from '../../src/snap/diskLayer';
import { DiffLayer, Snapshot } from '../../src/snap';
import { EMPTY_HASH, DBatch } from '../../src/utils';
import { isDiffLayerJournal } from '../../src/snap/journal';
import { TrieNodeIterator } from '../../src/snap/trieIterator';

class MockNode {
  public latestBlock: { header: { number: BN } } = { header: { number: new BN(1) } };
  public db: { getSnapRecoveryNumber: any } = { getSnapRecoveryNumber: async () => new BN(0) };
}

const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const cache = 100;
const db = new Database(level(), common);
const anotherDB = new Database(level(), common);
const node = new MockNode();
const async = true;
const rebuild = true;
const recovery = true;
let snaptree: SnapTree;
let anothorSnaptree: SnapTree | undefined;
let root: Buffer;
let accounts: AccountInfo[];
let diskLayer: DiskLayer;

type LayerInfo = {
  layer: Snapshot;
  accounts: AccountInfo[];
};

const layers: LayerInfo[] = [];

function journalToDiffLayer(parent: Snapshot, journalArray: any[], offset: number): Snapshot {
  if (offset > journalArray.length - 1) {
    return parent;
  }

  const journal = journalArray[offset];
  if (!isDiffLayerJournal(journal)) {
    throw new Error('invalid diff layer journal');
  }

  const root = journal[0];

  const destructSet = new FunctionalBufferSet();
  for (const accountHash of journal[1]) {
    destructSet.add(accountHash);
  }

  const accountData = new FunctionalBufferMap<Buffer>();
  for (const [accountHash, _accountData] of journal[2]) {
    accountData.set(accountHash, _accountData);
  }

  const storageData = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
  for (const [accountHash, storageHashes, storageValues] of journal[3]) {
    const storage = new FunctionalBufferMap<Buffer>();
    storageHashes.forEach((hash, i) => storage.set(hash, storageValues[i]));
    storageData.set(accountHash, storage);
  }

  return DiffLayer.createDiffLayerFromParent(parent, root, destructSet, accountData, storageData);
}

async function operateSnap(dbop: any) {
  const batch = new DBatch(snaptree.diskdb);
  batch.push(dbop);
  await batch.write();
  batch.reset();
}

async function getFirstLeafNode(root: Buffer) {
  for await (const node of new TrieNodeIterator(new BaseTrie(snaptree.diskdb.rawdb), root)) {
    if (node instanceof LeafNode) {
      return node.hash();
    }
  }
}

describe('SnapshotTree', () => {
  before(async () => {
    const rootAndAccounts = await genRandomAccounts(db, 64, 64);
    root = rootAndAccounts.root;
    accounts = rootAndAccounts.accounts;
    diskLayer = new DiskLayer(db, root);
    layers.push({ layer: diskLayer, accounts });
    snaptree = new SnapTree(db, cache, root, node as any);
    await snaptree.init(root, async, rebuild);
    // snaptree = (await SnapTree.createSnapTree(db, cache, root, async, rebuild, recovery))!;
    let count = 64;
    for (let i = 0; i < 6; i++) {
      const latest = layers[layers.length - 1];
      const { root, accounts } = await modifyRandomAccounts(db, latest.layer.root, latest.accounts, count);
      const layerNow = accountsToDiffLayer(latest.layer, root, accounts);
      layers.push({
        layer: layerNow,
        accounts
      });
      snaptree.update(root, latest.layer.root, layerNow.accountData, layerNow.destructSet, layerNow.storageData);
      count = Math.ceil(count / 2);
    }
  });

  it('should snapshot succeed', async () => {
    const layer = snaptree.snapShot(root);
    expect(layer?.root.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should snapShots correctly', async () => {
    const rets = snaptree.snapShots(layers[layers.length - 1].layer.root, layers.length, true)!;
    expect(rets?.length === layers.length - 1, 'snapshots number should be equal').be.true;
    for (let i = 0; i < rets.length; i++) {
      expect(rets[i].root.equals(layers[layers.length - (i + 1)].layer.root), 'snapshot root should be equal').be.true;
    }
  });

  it('should update correctly', async () => {
    const latest = layers[layers.length - 1];
    const { root, accounts } = await modifyRandomAccounts(db, latest.layer.root, latest.accounts, 1);
    const layerNow = accountsToDiffLayer(latest.layer, root, accounts);
    layers.push({
      layer: layerNow,
      accounts
    });
    snaptree.update(root, latest.layer.root, layerNow.accountData, layerNow.destructSet, layerNow.storageData);
    const snap = snaptree.snapShot(root)!;
    expect(snap.root.equals(layerNow.root), 'snapshot root should be equal').be.true;
  });

  it('should get diskroot correctly', async () => {
    const diskroot = snaptree.diskroot();
    expect(diskroot?.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should get diskLayer correctly', async () => {
    const disk = snaptree.diskLayer();
    expect(disk?.root.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should accountIterator correctly', async () => {
    for (const { layer, accounts } of layers) {
      const _accounts = [...accounts];
      for await (const { hash, getValue } of snaptree.accountIterator(layer.root, EMPTY_HASH)) {
        const index = _accounts.findIndex(({ address }) => keccak256(address).equals(hash));
        expect(index !== -1, 'account should exist in account list').be.true;
        const _account = getValue();
        expect(_account !== null, 'account should not be null').be.true;
        expect(_accounts[index].account.serialize().equals(_account!.serialize()), 'accout should be equal').be.true;
        _accounts.splice(index, 1);
      }
      expect(_accounts.length, 'account list should be empty').be.equal(0);
    }
  });

  it('should storageIterator correctly', async () => {
    for (const { layer, accounts } of layers) {
      for (const { address, storageData: _storageData } of accounts) {
        // copy storage data
        const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
        for (const [k, v] of _storageData) {
          storageData.set(k, { ...v });
        }

        const accountHash = keccak256(address);
        const { iter, destructed } = snaptree.storageIterator(layer.root, accountHash, EMPTY_HASH);
        expect(destructed, 'should not be destructed').be.false;
        for await (const { hash, getValue } of iter) {
          expect(storageData.get(hash)?.val.equals(getValue()), 'storage data should be equal').be.true;
          storageData.delete(hash);
        }
        expect(storageData.size, 'storage data should be empty').be.equal(0);
      }
    }
  });

  it('should journal correctly', async () => {
    const latest = layers[layers.length - 1];
    const base = await snaptree.journal(latest.layer.root);
    expect(base.equals(root), 'root should be equal').be.true;
    const journalData = rlp.decode(await db.getSnapJournal()) as any as any[];
    expect(bufferToInt(journalData[0]) === journalVersion, 'JournalVersion should be equal').be.true;
    expect(journalData[1].equals(root), 'root hash should be euqal').be.true;
    const difflayers = layers.slice(1) as { layer: DiffLayer; accounts: AccountInfo[] }[];
    for (const [_index, { layer, accounts }] of difflayers.entries()) {
      const newDiffLayer = journalToDiffLayer(layer.parent, journalData, _index + 2);
      const _accounts = [...accounts];
      for await (const { hash, getValue } of newDiffLayer.genAccountIterator(EMPTY_HASH)) {
        const index = _accounts.findIndex(({ address }) => keccak256(address).equals(hash));
        expect(index !== -1, 'account should exist in accout list').be.true;
        const _account = getValue();
        expect(_account !== null, 'account should not be null').be.true;
        expect(_accounts[index].account.serialize().equals(_account!.serialize()), 'accout should be equal').be.true;
        _accounts.splice(index, 1);
      }
      expect(_accounts.length, 'account list should be empty').be.equal(0);

      for (const { address, storageData: _storageData } of accounts) {
        const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
        for (const [k, v] of _storageData) {
          storageData.set(k, { ...v });
        }
        const accountHash = keccak256(address);
        const { iter, destructed } = newDiffLayer.genStorageIterator(accountHash, EMPTY_HASH);
        expect(destructed, 'should not be destructed').be.false;
        for await (const { hash, getValue } of iter) {
          expect(storageData.get(hash)?.val.equals(getValue()), 'storage data should be equal').be.true;
          storageData.delete(hash);
        }
        expect(storageData.size, 'storage data should be empty').be.equal(0);
      }
    }
  });

  it('should verify correctly', async () => {
    const rawDBOpts = { keyEncoding: 'binary', valueEncoding: 'binary' };
    const root = snaptree.diskroot()!;
    let verifiedResult = await snaptree.verify(root);
    expect(verifiedResult, 'Snap should verify correctly').be.true;

    //delete account from db
    let deleteKey = (await getFirstLeafNode(root))!;
    let value = await snaptree.diskdb.rawdb.get(deleteKey, rawDBOpts);
    await snaptree.diskdb.rawdb.del(deleteKey, rawDBOpts);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === false, 'Snap should not pass the verify').be.true;

    await snaptree.diskdb.rawdb.put(deleteKey, value, rawDBOpts);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === true, 'Snap should verify correctly').be.true;

    //delete account from snap
    const deletedAccountHash = layers[0].accounts[0].accountHash;
    value = await layers[0].layer.getSerializedAccount(deletedAccountHash);
    let dbop = DBDeleteSnapAccount(deletedAccountHash);
    await operateSnap(dbop);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === false, 'Snap should not pass the verify').be.true;

    dbop = DBSaveSerializedSnapAccount(deletedAccountHash, value);
    await operateSnap(dbop);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === true, 'Snap should not pass the verify').be.true;

    //delete slot from db
    deleteKey = (await getFirstLeafNode(layers[0].accounts[0].account.stateRoot))!;
    value = await snaptree.diskdb.rawdb.get(deleteKey, rawDBOpts);
    await snaptree.diskdb.rawdb.del(deleteKey, rawDBOpts);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === false, 'Snap should not pass the verify').be.true;

    await snaptree.diskdb.rawdb.put(deleteKey, value, rawDBOpts);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === true, 'Snap should verify correctly').be.true;

    //delete slot from snap
    const deletedStoragHash = Array.from(layers[0].accounts[0].storageData.keys())[0];
    dbop = DBDeleteSnapStorage(deletedAccountHash, deletedStoragHash as Buffer);
    await operateSnap(dbop);
    verifiedResult = await snaptree.verify(root);
    expect(verifiedResult === false, 'Snap should not pass the verify').be.true;
  });

  it('should cap correctly', async () => {
    let difflayersNumber = layers.length - 1;
    const bottomLayer = layers[difflayersNumber].layer;
    expect(snaptree.layers.size === difflayersNumber + 1, 'layers number should be equal').be.true;
    await snaptree.cap(bottomLayer.root, difflayersNumber);
    expect(snaptree.layers.size === difflayersNumber + 1, 'all layers should be reserved').be.true;

    let capNumber = 2;
    //Represents the number of layers expected to be compressed
    let reserveNumber = difflayersNumber - 1 - capNumber;
    difflayersNumber = difflayersNumber - capNumber;
    await snaptree.cap(bottomLayer.root, reserveNumber);
    expect(snaptree.layers.size === difflayersNumber + 1, `${capNumber} layers should be capped`).be.true;

    capNumber = 3;
    reserveNumber = difflayersNumber - 1 - capNumber;
    difflayersNumber = difflayersNumber - capNumber;
    await snaptree.cap(bottomLayer.root, reserveNumber);
    expect(snaptree.layers.size === difflayersNumber + 1, `${capNumber} layers should be reserved`).be.true;

    await snaptree.cap(bottomLayer.root, 0);
    expect(snaptree.layers.size === 1, 'all difflayers should be fallened').be.true;
  });

  it('should disable correctly', async () => {
    anothorSnaptree = new SnapTree(anotherDB, cache, root, node as any);
    await anothorSnaptree.init(root, async, rebuild);
    for (let i = 1; i < layers.length; i++) {
      anothorSnaptree.update(layers[i].layer.root, layers[i - 1].layer.root, (layers[i].layer as DiffLayer).accountData, (layers[i].layer as DiffLayer).destructSet, (layers[i].layer as DiffLayer).storageData);
    }
    const snapsBefore = anothorSnaptree.snapShots(layers[layers.length - 1].layer.root, layers.length, false)!;
    for (const snap of snapsBefore) {
      expect(snap.stale === false, 'snap stale should be false').be.true;
    }
    await anothorSnaptree.disable();
    const snapsAfter = anothorSnaptree.snapShots(layers[layers.length - 1].layer.root, layers.length, false);
    expect(snapsAfter === undefined, 'all layers should be deleted').be.true;
  });
});
