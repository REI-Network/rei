import { expect } from 'chai';
import { keccak256, rlp, bufferToInt } from 'ethereumjs-util';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { SnapTree, journalVersion } from '../../src/snap/snapTree';
import { AccountInfo, accountsToDiffLayer, genRandomAccounts, modifyRandomAccounts } from './util';
import { DiskLayer } from '../../src/snap/diskLayer';
import { DiffLayer, Snapshot } from '../../src/snap';
import { EMPTY_HASH } from '../../src/utils';
import { isDiffLayerJournal } from '../../src/snap/journal';

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
const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const cache = 100;
const db = new Database(level(), common);
const anotherDB = new Database(level(), common);
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
describe('SnapshotTree', () => {
  before(async () => {
    const rootAndAccounts = await genRandomAccounts(db, 64, 64);
    root = rootAndAccounts.root;
    accounts = rootAndAccounts.accounts;
    diskLayer = new DiskLayer(db, root);
    layers.push({ layer: diskLayer, accounts });
    snaptree = (await SnapTree.createSnapTree(db, cache, root, async, rebuild, recovery))!;
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
    for (const layer of layers) {
      const verifyResult = await snaptree.verify(layer.layer.root);
      expect(verifyResult === true, 'snapshot should be verified correctly').be.true;
    }
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
    anothorSnaptree = (await SnapTree.createSnapTree(anotherDB, cache, root, async, rebuild, recovery))!;
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
