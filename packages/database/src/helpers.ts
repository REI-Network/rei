import { BN, rlp, toBuffer } from 'ethereumjs-util';
import { Block, BlockHeader, Receipt } from '@rei-network/structure';
import { DBOp, DBTarget } from './operation';
import { bufBE8 } from './constants';

/*
 * This extra helper file serves as an interface between the blockchain API functionality
 * and the DB operations from `db/operation.ts` and also handles the right encoding of the keys
 */

function DBSetTD(TD: BN, blockNumber: BN, blockHash: Buffer): DBOp {
  return DBOp.set(DBTarget.TotalDifficulty, rlp.encode(TD), {
    blockNumber,
    blockHash
  });
}

/*
 * This method accepts either a BlockHeader or a Block and returns a list of DatabaseOperation instances
 *
 * - A "Set Header Operation" is always added
 * - A "Set Body Operation" is only added if the body is not empty (it has transactions/uncles) or if the block is the genesis block
 * (if there is a header but no block saved the DB will implicitly assume the block to be empty)
 */
function DBSetBlockOrHeader(blockBody: Block | BlockHeader): DBOp[] {
  const header: BlockHeader = blockBody instanceof Block ? blockBody.header : blockBody;
  const dbOps: DBOp[] = [];

  const blockNumber = header.number;
  const blockHash = header.hash();

  const headerValue = header.serialize();
  dbOps.push(
    DBOp.set(DBTarget.Header, headerValue, {
      blockNumber,
      blockHash
    })
  );

  const isGenesis = header.number.eqn(0);

  if (isGenesis || (blockBody instanceof Block && (blockBody.transactions.length || blockBody.uncleHeaders.length))) {
    const bodyValue = rlp.encode(blockBody.raw().slice(1));
    dbOps.push(
      DBOp.set(DBTarget.Body, bodyValue, {
        blockNumber,
        blockHash
      })
    );
  }

  return dbOps;
}

function DBSetHashToNumber(blockHash: Buffer, blockNumber: BN): DBOp {
  const blockNumber8Byte = bufBE8(blockNumber);
  return DBOp.set(DBTarget.HashToNumber, blockNumber8Byte, {
    blockHash
  });
}

function DBSaveLookups(blockHash: Buffer, blockNumber: BN): DBOp[] {
  const ops: DBOp[] = [];
  ops.push(DBOp.set(DBTarget.NumberToHash, blockHash, { blockNumber }));

  const blockNumber8Bytes = bufBE8(blockNumber);
  ops.push(
    DBOp.set(DBTarget.HashToNumber, blockNumber8Bytes, {
      blockHash
    })
  );
  return ops;
}

/**
 * Create Receipts operation for the given receipts
 * @param receipts - Target receipts
 * @param blockHash - Block hash
 * @param blockNumber - Block number
 * @returns New operation
 */
function DBSaveReceipts(receipts: Receipt[], blockHash: Buffer, blockNumber: BN) {
  return DBOp.set(DBTarget.Receipts, rlp.encode(receipts.map((r) => r.raw())), {
    blockHash,
    blockNumber
  });
}

/**
 * Create TxLookup operations for all transactions of the given block
 * @param block - Target block
 * @returns Array of operations
 */
function DBSaveTxLookup(block: Block): DBOp[] {
  const dbOps: DBOp[] = [];
  const blockNumber = block.header.number;

  for (const tx of block.transactions) {
    dbOps.push(
      DBOp.set(DBTarget.TxLookup, toBuffer(blockNumber), {
        txHash: tx.hash()
      })
    );
  }

  return dbOps;
}

/**
 * Create BloomBits operation for the given section
 * @param bit - Bit index of target section
 * @param section - Section number
 * @param hash - Hash of the last block header of the target section
 * @param bits - Bloom bits data
 * @returns New operation
 */
function DBSaveBloomBits(bit: number, section: BN, hash: Buffer, bits: Buffer) {
  return DBOp.set(DBTarget.BloomBits, bits, { bit, section, hash });
}

export { DBOp, DBSetTD, DBSetBlockOrHeader, DBSetHashToNumber, DBSaveLookups, DBSaveReceipts, DBSaveTxLookup, DBSaveBloomBits };
