import { Block } from '@ethereumjs/block';
import { bnToHex, bufferToHex } from 'ethereumjs-util';

export class WrappedBlock {
  readonly block: Block;
  constructor(block: Block) {
    this.block = block;
  }

  toRPCJSON() {
    return {
      number: this.block.header.number ? bnToHex(this.block.header.number) : undefined,
      hash: this.block.hash() ? bufferToHex(this.block.hash()) : undefined,
      parentHash: bufferToHex(this.block.header.parentHash),
      nonce: this.block.header.nonce ? bufferToHex(this.block.header.nonce) : undefined
      //sha3Uncles:
    };
  }
}

export * from '@ethereumjs/block';
