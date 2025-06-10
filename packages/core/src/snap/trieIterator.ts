import { BaseTrie as Trie } from '@rei-network/trie';
import { nibblesToBuffer } from '@rei-network/trie/dist/util/nibbles';
import {
  BranchNode,
  ExtensionNode,
  LeafNode,
  Nibbles,
  TrieNode
} from '@rei-network/trie/dist/trieNode';

export type NodeEntry = { key: Buffer; val: Buffer };

export class KVIterator {
  private readonly trie: Trie;
  private readonly root: Buffer;

  constructor(trie: Trie, root?: Buffer) {
    this.trie = trie;
    this.root = root ?? trie.root;
  }

  private async *traverse(
    node: TrieNode | null,
    key: Nibbles
  ): AsyncGenerator<NodeEntry, NodeEntry | void> {
    if (node instanceof BranchNode) {
      if (node._value && node._value.length > 0) {
        yield {
          key: nibblesToBuffer(key),
          val: node._value
        };
      }

      for (let i = 0; i < 16; i++) {
        const next = node.getBranch(i);
        yield* this.traverse(
          next && (await this.trie._lookupNode(next)),
          key.concat([i])
        );
      }
    } else if (node instanceof ExtensionNode) {
      yield* this.traverse(
        await this.trie._lookupNode(node._value),
        key.concat(node._nibbles)
      );
    } else if (node instanceof LeafNode) {
      yield {
        key: nibblesToBuffer(key.concat(node._nibbles)),
        val: node._value
      };
    }
  }

  async *[Symbol.asyncIterator]() {
    yield* this.traverse(await this.trie._lookupNode(this.root), []);
  }
}

export class TrieNodeIterator {
  private readonly trie: Trie;
  private readonly root: Buffer;

  constructor(trie: Trie, root?: Buffer) {
    this.trie = trie;
    this.root = root ?? trie.root;
  }

  private async *traverse(
    node: TrieNode | null,
    key: Nibbles
  ): AsyncGenerator<TrieNode, TrieNode | void> {
    if (node === null) {
      return;
    }

    if (node instanceof BranchNode) {
      for (let i = 0; i < 16; i++) {
        const next = node.getBranch(i);
        yield* this.traverse(
          next && (await this.trie._lookupNode(next)),
          key.concat([i])
        );
      }
    } else if (node instanceof ExtensionNode) {
      yield* this.traverse(
        await this.trie._lookupNode(node._value),
        key.concat(node._nibbles)
      );
    }

    yield node;
  }

  async *[Symbol.asyncIterator]() {
    yield* this.traverse(await this.trie._lookupNode(this.root), []);
  }
}
