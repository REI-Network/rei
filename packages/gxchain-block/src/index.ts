import { Block as EthereumJSBlock, BlockHeader as EthereumJSBlockHeander, BlockBuffer, BlockHeaderBuffer, BlockBodyBuffer, BlockOptions, BlockData, HeaderData, JsonBlock, JsonHeader } from '@ethereumjs/block';
import { Address, BN, KECCAK256_RLP_ARRAY, KECCAK256_RLP, rlp, toBuffer, zeros } from 'ethereumjs-util';

import { Transaction, TxOptions } from '@gxchain2/tx';

const DEFAULT_GAS_LIMIT = new BN(Buffer.from('ffffffffffffff', 'hex'));

export class Block extends EthereumJSBlock {
  public static fromBlockData(blockData: BlockData = {}, opts?: BlockOptions) {
    const { header: headerData, transactions: txsData, uncleHeaders: uhsData } = blockData;

    const header = BlockHeader.fromHeaderData(headerData, opts);

    // parse transactions
    const transactions: Transaction[] = [];
    for (const txData of txsData || []) {
      const tx = Transaction.fromTxData(txData, opts as TxOptions);
      transactions.push(tx);
    }

    // parse uncle headers
    const uncleHeaders: BlockHeader[] = [];
    for (const uhData of uhsData || []) {
      const uh = BlockHeader.fromHeaderData(uhData, {
        ...opts,
        // Disable this option here (all other options carried over), since this overwrites the provided Difficulty to an incorrect value
        calcDifficultyFromHeader: undefined
      });
      uncleHeaders.push(uh);
    }

    return new Block(header, transactions, uncleHeaders, opts);
  }

  public static fromRLPSerializedBlock(serialized: Buffer, opts?: BlockOptions) {
    const values = (rlp.decode(serialized) as any) as BlockBuffer;

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized block input. Must be array');
    }

    return Block.fromValuesArray(values, opts);
  }

  public static fromValuesArray(values: BlockBuffer, opts?: BlockOptions) {
    if (values.length > 3) {
      throw new Error('invalid block. More values than expected were received');
    }

    const [headerData, txsData, uhsData] = values;

    const header = BlockHeader.fromValuesArray(headerData, opts);

    // parse transactions
    const transactions: Transaction[] = [];
    for (const txData of txsData || []) {
      transactions.push(Transaction.fromValuesArray(txData, opts));
    }

    // parse uncle headers
    const uncleHeaders: BlockHeader[] = [];
    for (const uncleHeaderData of uhsData || []) {
      uncleHeaders.push(
        BlockHeader.fromValuesArray(uncleHeaderData, {
          ...opts,
          // Disable this option here (all other options carried over), since this overwrites the provided Difficulty to an incorrect value
          calcDifficultyFromHeader: undefined
        })
      );
    }

    return new Block(header, transactions, uncleHeaders, opts);
  }

  /**
   * Alias for Block.fromBlockData() with initWithGenesisHeader set to true.
   */
  public static genesis(blockData: BlockData = {}, opts?: BlockOptions) {
    opts = { ...opts, initWithGenesisHeader: true };
    return Block.fromBlockData(blockData, opts);
  }
}

export class BlockHeader extends EthereumJSBlockHeander {
  public static fromHeaderData(headerData: HeaderData = {}, opts?: BlockOptions) {
    const { parentHash, uncleHash, coinbase, stateRoot, transactionsTrie, receiptTrie, bloom, difficulty, number, gasLimit, gasUsed, timestamp, extraData, mixHash, nonce } = headerData;

    return new BlockHeader(
      parentHash ? toBuffer(parentHash) : zeros(32),
      uncleHash ? toBuffer(uncleHash) : KECCAK256_RLP_ARRAY,
      coinbase ? new Address(toBuffer(coinbase)) : Address.zero(),
      stateRoot ? toBuffer(stateRoot) : zeros(32),
      transactionsTrie ? toBuffer(transactionsTrie) : KECCAK256_RLP,
      receiptTrie ? toBuffer(receiptTrie) : KECCAK256_RLP,
      bloom ? toBuffer(bloom) : zeros(256),
      difficulty ? new BN(toBuffer(difficulty)) : new BN(0),
      number ? new BN(toBuffer(number)) : new BN(0),
      gasLimit ? new BN(toBuffer(gasLimit)) : DEFAULT_GAS_LIMIT,
      gasUsed ? new BN(toBuffer(gasUsed)) : new BN(0),
      timestamp ? new BN(toBuffer(timestamp)) : new BN(0),
      extraData ? toBuffer(extraData) : Buffer.from([]),
      mixHash ? toBuffer(mixHash) : zeros(32),
      nonce ? toBuffer(nonce) : zeros(8),
      opts
    );
  }

  public static fromRLPSerializedHeader(serialized: Buffer, opts?: BlockOptions) {
    const values = rlp.decode(serialized);

    if (!Array.isArray(values)) {
      throw new Error('Invalid serialized header input. Must be array');
    }

    return BlockHeader.fromValuesArray(values, opts);
  }

  public static fromValuesArray(values: BlockHeaderBuffer, opts?: BlockOptions) {
    if (values.length > 15) {
      throw new Error('invalid header. More values than expected were received');
    }

    const [parentHash, uncleHash, coinbase, stateRoot, transactionsTrie, receiptTrie, bloom, difficulty, number, gasLimit, gasUsed, timestamp, extraData, mixHash, nonce] = values;

    return new BlockHeader(toBuffer(parentHash), toBuffer(uncleHash), new Address(toBuffer(coinbase)), toBuffer(stateRoot), toBuffer(transactionsTrie), toBuffer(receiptTrie), toBuffer(bloom), new BN(toBuffer(difficulty)), new BN(toBuffer(number)), new BN(toBuffer(gasLimit)), new BN(toBuffer(gasUsed)), new BN(toBuffer(timestamp)), toBuffer(extraData), toBuffer(mixHash), toBuffer(nonce), opts);
  }

  /**
   * Alias for Header.fromHeaderData() with initWithGenesisHeader set to true.
   */
  public static genesis(headerData: HeaderData = {}, opts?: BlockOptions) {
    opts = { ...opts, initWithGenesisHeader: true };
    return BlockHeader.fromHeaderData(headerData, opts);
  }
}

export { BlockBuffer, BlockHeaderBuffer, BlockBodyBuffer, JsonBlock, JsonHeader };
