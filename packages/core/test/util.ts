import fs from 'fs';
import path from 'path';
import { Block, BlockData } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { Node } from '../src';

export async function createNode(dirname: string, chain: string) {
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
  fs.rmdirSync(path.join(__dirname, '/' + dirname, '/test-dir'), { recursive: true });
}

export function loadBlocksFromTestData(dirname: string, key: string, chain: string, cliqueSigner?: Buffer) {
  const result: { [key: string]: BlockData[] } = JSON.parse(fs.readFileSync(path.join(__dirname, '/' + dirname, '/test-data.json')).toString());
  return result[key].map((b) => Block.fromBlockData(b, { common: Common.createChainStartCommon(chain), hardforkByBlockNumber: true, cliqueSigner }));
}
