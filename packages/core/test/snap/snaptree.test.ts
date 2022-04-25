import { expect } from 'chai';
import { keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { SnapTree } from '../../src/snap/snapTree';
import { AccountInfo, accountsToDiffLayer, genRandomAccounts, modifyRandomAccounts } from './util';
import { DiskLayer } from '../../src/snap/diskLayer';
import { DiffLayer, Snapshot } from '../../src/snap';
import { EMPTY_HASH } from '../../src/utils';

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
    const rootAndAccounts = await genRandomAccounts(db, 30, 30);
    root = rootAndAccounts.root;
    accounts = rootAndAccounts.accounts;
    diskLayer = new DiskLayer(db, root);
    layers.push({ layer: diskLayer, accounts });
    snaptree = (await SnapTree.createSnapTree(db, cache, root, async, rebuild, recovery))!;
    let count = 2;
    for (let i = 0; i < 9; i++) {
      const latest = layers[layers.length - 1];
      const { root, accounts } = await modifyRandomAccounts(db, latest.layer.root, latest.accounts, count);
      const layerNow = accountsToDiffLayer(latest.layer, root, accounts);
      layers.push({
        layer: layerNow,
        accounts
      });
      snaptree.update(root, latest.layer.root, layerNow.accountData, layerNow.destructSet, layerNow.storageData);
      count += 2;
    }
  });

  it('should snapshot succeed', async () => {
    const layer = snaptree.snapShot(root);
    expect(layer?.root.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should snapShots correctly', async () => {
    const rets = snaptree.snapShots(layers[layers.length - 1].layer.root, layers.length + 1, true);
    expect(rets?.length === layers.length - 1, 'snapshots number should be equal').be.true;
    for (let i = 0; i < rets!.length; i++) {
      expect(rets![i].root.equals(layers[layers.length - (i + 1)].layer.root), 'snapshot root should be equal').be.true;
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
    const snap = snaptree.snapShot(root);
    expect(snap.root.equals(layerNow.root), 'snapshot root should be equal').be.true;
  });

  it('should get diskroot correctly', async () => {
    const diskroot = snaptree?.diskroot();
    expect(diskroot?.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should get diskLayer correctly', async () => {
    const disk = snaptree?.diskLayer();
    expect(disk?.root.equals(diskLayer.root), 'snapshot root should be equal').be.true;
  });

  it('should accountIterator correctly', async () => {
    for (const { layer, accounts } of layers) {
      const _accounts = [...accounts];
      for await (const { hash, getValue } of snaptree!.accountIterator(layer.root, EMPTY_HASH)) {
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
        const { iter, destructed } = snaptree!.storageIterator(layer.root, accountHash, EMPTY_HASH);
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
    for await (const layer of layers) {
      const base = await snaptree?.journal(layer.layer.root);
      expect(base.equals(root), 'root should be equal').be.true;
    }
  });

  it('should cap correctly', async () => {
    const bottom = layers[layers.length - 1];
    let layersNumber = layers.length;
    expect(snaptree?.layers.size === layersNumber, 'layers number should be equal').be.true;
    await snaptree?.cap(bottom.layer.root, layersNumber);
    expect(snaptree?.layers.size === layersNumber, 'all layers should be reserved').be.true;
    let capNumber = 4;
    layersNumber = layersNumber - capNumber + 2;
    await snaptree?.cap(bottom.layer.root, layersNumber - 2);
    expect(snaptree?.layers.size === layersNumber, `${layersNumber - 1} layers should be reserved`).be.true;
    let diskroot = snaptree?.diskroot();
    expect(diskroot?.equals(layers[layers.length - layersNumber].layer.root), 'diskroot should be equal').be.true;

    capNumber = 7;
    layersNumber = layersNumber - capNumber + 2;
    await snaptree?.cap(bottom.layer.root, layersNumber - 2);
    expect(snaptree?.layers.size === layersNumber, `${layersNumber - 1} layers should be reserved`).be.true;
    diskroot = snaptree?.diskroot();
    expect(diskroot?.equals(layers[layers.length - layersNumber].layer.root), 'diskroot should be equal').be.true;

    await snaptree?.cap(bottom.layer.root, 0);
    expect(snaptree?.layers.size === 1, 'all difflayers should be fallened').be.true;
    diskroot = snaptree?.diskroot();
    expect(diskroot?.equals(layers[layers.length - 1].layer.root), 'diskroot should be equal').be.true;
  });

  it('should disable correctly', async () => {
    anothorSnaptree = await SnapTree.createSnapTree(anotherDB, cache, root, async, rebuild, recovery);
    for (let i = 1; i < layers.length; i++) {
      anothorSnaptree?.update(layers[i].layer.root, layers[i - 1].layer.root, (layers[i].layer as DiffLayer).accountData, (layers[i].layer as DiffLayer).destructSet, (layers[i].layer as DiffLayer).storageData);
    }
    const snapsBefore = anothorSnaptree?.snapShots(layers[layers.length - 1].layer.root, layers.length, false);
    for (const snap of snapsBefore!) {
      expect(snap.stale === false, 'snap stale should be false').be.true;
    }
    await anothorSnaptree?.disable();
    const snapsAfter = anothorSnaptree?.snapShots(layers[layers.length - 1].layer.root, layers.length, false);
    expect(snapsAfter === undefined, 'all layers should be deleted').be.true;
  });
});
