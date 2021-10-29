import fs from 'fs';
import path from 'path';
import { Address } from 'ethereumjs-util';
import { Block, BlockData } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { FunctionalMap } from '@gxchain2/utils';
import { Node } from '../src';

function clearup(dirname: string) {
  fs.rmdirSync(path.join(__dirname, '/' + dirname, '/test-dir'), { recursive: true });
}

export async function createNode(dirname: string, chain: string | { chain: any; genesisState?: any }) {
  clearup(dirname);
  const testdir = path.join(__dirname, '/' + dirname, '/test-dir');
  if (!fs.existsSync(testdir)) {
    fs.mkdirSync(testdir, { recursive: true });
  }
  const node = new Node({
    databasePath: testdir,
    chain,
    mine: {
      enable: false
    },
    p2p: {
      enable: false
    },
    account: {
      keyStorePath: path.join(testdir, 'keystore'),
      unlock: []
    }
  });
  await node.init();
  return node;
}

export async function destroyNode(dirname: string, node: Node) {
  await node.abort();
  clearup(dirname);
}

export function loadBlocksFromTestData(dirname: string, key: string, chain: string | { chain: any; genesisState?: any }, cliqueSigner?: Buffer) {
  const result: { [key: string]: BlockData[] } = JSON.parse(fs.readFileSync(path.join(__dirname, '/' + dirname, '/test-data.json')).toString());
  return result[key].map((b) => Block.fromBlockData(b, { common: Common.createChainStartCommon(chain), hardforkByBlockNumber: true, cliqueSigner }));
}

/////////////////////////////

export class MockAccountManager {
  private nameToAddress = new Map<string, Address>();
  private addressToName = new FunctionalMap<Address, string>((a: Address, b: Address) => a.buf.compare(b.buf));

  constructor(addresses: [string, Address][]) {
    for (const [name, address] of addresses) {
      this.nameToAddress.set(name, address);
      this.addressToName.set(address, name);
    }
  }

  n2a(name: string) {
    const address = this.nameToAddress.get(name);
    if (!address) {
      throw new Error('missing name:' + name);
    }
    return address;
  }

  a2n(address: Address) {
    const name = this.addressToName.get(address);
    if (!name) {
      throw new Error('missing address:' + address.toString());
    }
    return name;
  }
}
