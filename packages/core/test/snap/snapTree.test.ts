import { expect } from 'chai';
import { keccak256, rlp, bufferToInt } from 'ethereumjs-util';
import { BaseTrie } from '@rei-network/trie';
import { LeafNode } from '@rei-network/trie/dist/trieNode';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import {
  Database,
  DBDeleteSnapAccount,
  DBDeleteSnapStorage,
  DBSaveSerializedSnapAccount
} from '@rei-network/database';
import { SnapTree, journalVersion } from '../../src/snap/snapTree';
import {
  AccountInfo,
  accountsToDiffLayer,
  genRandomAccounts,
  modifyRandomAccounts
} from './util';
import { DiskLayer } from '../../src/snap/diskLayer';
import { DiffLayer, Snapshot } from '../../src/snap';
import { EMPTY_HASH, DBatch } from '../../src/utils';
import { isDiffLayerJournal } from '../../src/snap/journal';
import { TrieNodeIterator } from '../../src/snap/trieIterator';

const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
let snaptree: SnapTree;
let root: Buffer;
let accounts: AccountInfo[];
let diskLayer: DiskLayer;

type LayerInfo = {
  layer: Snapshot;
  accounts: AccountInfo[];
};

const layers: LayerInfo[] = [];

function journalToDiffLayer(
  parent: Snapshot,
  journalArray: any[],
  offset: number
): Snapshot {
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

  return DiffLayer.createDiffLayerFromParent(
    parent,
    root,
    destructSet,
    accountData,
    storageData
  );
}

async function operateSnap(dbop: any) {
  const batch = new DBatch(snaptree.diskdb);
  batch.push(dbop);
  await batch.write();
}

async function getFirstLeafNode(root: Buffer) {
  for await (const node of new TrieNodeIterator(
    new BaseTrie(snaptree.diskdb.rawdb),
    root
  )) {
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
    snaptree = new SnapTree(db);
  });

  it('should init snaptree and get snapshot correctly', async () => {
    await snaptree.init(root, false, true);
    const disk = snaptree.snapshot(root);
    expect(disk!.root.equals(diskLayer.root), 'Disklayer root should be equal')
      .be.true;
  });

  it('should update and get snapshots correctly', async () => {
    for (let i = 0; i < 7; i++) {
      const latest = layers[layers.length - 1];
      const { root, accounts } = await modifyRandomAccounts(
        db,
        latest.layer.root,
        latest.accounts,
        64
      );
      const layer = accountsToDiffLayer(latest.layer, root, accounts);
      layers.push({
        layer: layer,
        accounts
      });
      snaptree.update(
        root,
        latest.layer.root,
        layer.accountData,
        layer.destructSet,
        layer.storageData
      );
    }

    const rets = snaptree.snapshots(
      layers[layers.length - 1].layer.root,
      layers.length,
      true
    )!;
    expect(
      rets?.length === layers.length - 1,
      'snapshots number should be equal'
    ).be.true;
    for (let i = 0; i < rets.length; i++) {
      expect(
        rets[i].root.equals(layers[layers.length - (i + 1)].layer.root),
        'snapshot root should be equal'
      ).be.true;
    }
  });

  it('should discard correctly', async () => {
    const latest = layers[layers.length - 2];
    const { root, accounts } = await modifyRandomAccounts(
      db,
      latest.layer.root,
      latest.accounts,
      64
    );
    const layer = accountsToDiffLayer(latest.layer, root, accounts);
    snaptree.update(
      root,
      latest.layer.root,
      layer.accountData,
      layer.destructSet,
      layer.storageData
    );
    expect(snaptree.layers.size).be.equal(9);
    snaptree.discard(layers[layers.length - 1].layer.root);
    expect(snaptree.layers.size).be.equal(8);
  });

  it('should get diskroot correctly', async () => {
    const diskroot = snaptree.diskroot();
    expect(diskroot?.equals(diskLayer.root), 'snapshot root should be equal').be
      .true;
  });

  it('should get diskLayer correctly', async () => {
    const disk = snaptree.diskLayer();
    expect(disk?.root.equals(diskLayer.root), 'snapshot root should be equal')
      .be.true;
  });

  it('should generate accountIterator correctly', async () => {
    for (const { layer, accounts } of layers) {
      const _accounts = [...accounts];
      for await (const { hash, value } of await snaptree.accountIterator(
        layer.root,
        EMPTY_HASH
      )) {
        const index = _accounts.findIndex(({ address }) =>
          keccak256(address).equals(hash)
        );
        expect(index !== -1, 'account should exist in account list').be.true;
        const _account = value;
        expect(_account !== null, 'account should not be null').be.true;
        expect(
          _accounts[index].account.serialize().equals(_account.serialize()),
          'accout should be equal'
        ).be.true;
        _accounts.splice(index, 1);
      }
      expect(_accounts.length, 'account list should be empty').be.equal(0);
    }
  });

  it('should generate storageIterator correctly', async () => {
    for (const { layer, accounts } of layers) {
      for (const { address, storageData: _storageData } of accounts) {
        // copy storage data
        const storageData = new FunctionalBufferMap<{
          key: Buffer;
          val: Buffer;
        }>();
        for (const [k, v] of _storageData) {
          storageData.set(k, { ...v });
        }

        const accountHash = keccak256(address);
        let totalCount = 0;
        for await (const { hash, value } of await snaptree.storageIterator(
          layer.root,
          accountHash,
          EMPTY_HASH
        )) {
          const expectStorageData = await layer.getStorage(accountHash, hash);
          expect(
            expectStorageData.equals(value),
            'storage data should be equal'
          ).be.true;
          totalCount++;
        }
        expect(totalCount, 'total count should be equal').be.equal(
          layers[0].accounts[0].storageData.size
        );
      }
    }
  });

  it('should journal correctly', async () => {
    const latest = layers[layers.length - 1];
    const base = await snaptree.journal(latest.layer.root);
    expect(base!.equals(root), 'root should be equal').be.true;
    const journalData = rlp.decode(await db.getSnapJournal()) as any as any[];
    expect(
      bufferToInt(journalData[0]) === journalVersion,
      'JournalVersion should be equal'
    ).be.true;
    expect(journalData[1].equals(root), 'root hash should be euqal').be.true;
    const difflayers = layers.slice(1) as {
      layer: DiffLayer;
      accounts: AccountInfo[];
    }[];
    for (const [_index, { layer, accounts }] of difflayers.entries()) {
      const newDiffLayer = journalToDiffLayer(
        layer.parent,
        journalData,
        _index + 2
      );
      const _accounts = [...accounts];
      for await (const { hash, getValue } of newDiffLayer.genAccountIterator(
        EMPTY_HASH
      )) {
        const index = _accounts.findIndex(({ address }) =>
          keccak256(address).equals(hash)
        );
        expect(index !== -1, 'account should exist in accout list').be.true;
        const _account = getValue();
        expect(_account !== null, 'account should not be null').be.true;
        expect(
          _accounts[index].account.serialize().equals(_account!.serialize()),
          'accout should be equal'
        ).be.true;
        _accounts.splice(index, 1);
      }
      expect(_accounts.length, 'account list should be empty').be.equal(0);

      for (const { address, storageData: _storageData } of accounts) {
        const storageData = new FunctionalBufferMap<{
          key: Buffer;
          val: Buffer;
        }>();
        for (const [k, v] of _storageData) {
          storageData.set(k, { ...v });
        }
        const accountHash = keccak256(address);
        const { iter, destructed } = newDiffLayer.genStorageIterator(
          accountHash,
          EMPTY_HASH
        );
        expect(destructed, 'should not be destructed').be.false;
        for await (const { hash, getValue } of iter) {
          expect(
            storageData.get(hash)?.val.equals(getValue()),
            'storage data should be equal'
          ).be.true;
          storageData.delete(hash);
        }
        expect(storageData.size, 'storage data should be empty').be.equal(0);
      }
    }
  });

  it('should verify correctly', async () => {
    const rawDBOpts = { keyEncoding: 'binary', valueEncoding: 'binary' };
    const root = snaptree.diskroot()!;
    expect(await snaptree.verify(root), 'Snap should verify correctly').be.true;

    // delete account from db
    let deleteKey = (await getFirstLeafNode(root))!;
    let value = await snaptree.diskdb.rawdb.get(deleteKey, rawDBOpts);
    await snaptree.diskdb.rawdb.del(deleteKey, rawDBOpts);
    expect(await snaptree.verify(root), 'Snap should not pass the verify').be
      .false;

    await snaptree.diskdb.rawdb.put(deleteKey, value, rawDBOpts);
    expect(await snaptree.verify(root), 'Snap should verify correctly').be.true;

    // delete account from snap
    const deletedAccountHash = layers[0].accounts[0].accountHash;
    value = await layers[0].layer.getSerializedAccount(deletedAccountHash);
    let dbop = DBDeleteSnapAccount(deletedAccountHash);
    await operateSnap(dbop);
    expect(await snaptree.verify(root), 'Snap should not pass the verify').be
      .false;

    dbop = DBSaveSerializedSnapAccount(deletedAccountHash, value);
    await operateSnap(dbop);
    expect(await snaptree.verify(root), 'Snap should verify correctly').be.true;

    // delete slot from db
    deleteKey = (await getFirstLeafNode(
      layers[0].accounts[0].account.stateRoot
    ))!;
    value = await snaptree.diskdb.rawdb.get(deleteKey, rawDBOpts);
    await snaptree.diskdb.rawdb.del(deleteKey, rawDBOpts);
    expect(await snaptree.verify(root), 'Snap should not pass the verify').be
      .false;

    await snaptree.diskdb.rawdb.put(deleteKey, value, rawDBOpts);
    expect(await snaptree.verify(root), 'Snap should verify correctly').be.true;

    // delete slot from snap
    const deletedStoragHash = Array.from(
      layers[0].accounts[0].storageData.keys()
    )[0];
    dbop = DBDeleteSnapStorage(deletedAccountHash, deletedStoragHash as Buffer);
    await operateSnap(dbop);
    expect(await snaptree.verify(root), 'Snap should not pass the verify').be
      .false;
  });

  it('should cap correctly', async () => {
    let difflayersNumber = layers.length - 1;
    const bottomRoot = layers[difflayersNumber].layer.root;
    expect(
      snaptree.layers.size === difflayersNumber + 1,
      'layers number should be equal'
    ).be.true;
    let survivedLayer = layers[layers.length - difflayersNumber].layer;

    let readOk = false;
    (async () => {
      for await (const _ of await snaptree.accountIterator(
        layers[0].layer.root,
        EMPTY_HASH
      )) {
        await new Promise((r) => setTimeout(r, 10));
      }
      readOk = true;
    })();

    await snaptree.cap(bottomRoot, difflayersNumber);

    expect(readOk, 'read should be ok').be.true;
    expect(
      snaptree.layers.size === difflayersNumber + 1,
      'all layers should be reserved'
    ).be.true;
    let topLayer = snaptree.snapshot(survivedLayer.root);
    expect(
      topLayer!.parent!.root.equals(snaptree.diskroot()!),
      'parent root and diskroot should be equal'
    ).be.true;

    let capNumber = 2;
    // Represents the number of layers expected to be compressed
    let reserveNumber = difflayersNumber - 1 - capNumber;
    difflayersNumber = difflayersNumber - capNumber;
    survivedLayer = layers[layers.length - difflayersNumber].layer;
    await snaptree.cap(bottomRoot, reserveNumber);
    expect(
      snaptree.layers.size === difflayersNumber + 1,
      `${capNumber} layers should be capped`
    ).be.true;
    topLayer = snaptree.snapshot(survivedLayer.root);
    expect(
      topLayer!.parent!.root.equals(snaptree.diskroot()!),
      'parent root and diskroot should be equal'
    ).be.true;

    capNumber = 3;
    reserveNumber = difflayersNumber - 1 - capNumber;
    difflayersNumber = difflayersNumber - capNumber;
    survivedLayer = layers[layers.length - difflayersNumber].layer;
    await snaptree.cap(bottomRoot, reserveNumber);
    expect(
      snaptree.layers.size === difflayersNumber + 1,
      `${capNumber} layers should be reserved`
    ).be.true;
    topLayer = snaptree.snapshot(survivedLayer.root);
    expect(
      topLayer!.parent!.root.equals(snaptree.diskroot()!),
      'parent root and diskroot should be equal'
    ).be.true;

    await snaptree.cap(bottomRoot, 0);
    expect(snaptree.layers.size === 1, 'all difflayers should be fallened').be
      .true;
  });

  it('should disable correctly', async () => {
    await snaptree.disable();
    expect(snaptree.layers.size, 'all layers should be deleted').be.equal(0);
  });
});
