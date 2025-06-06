import { BN, rlp, toBuffer } from 'ethereumjs-util';
import { Block, BlockHeader, Receipt } from '@rei-network/structure';
import { DBOp, DBTarget } from './operation';
import { bufBE8 } from './constants';

/*
 * This extra helper file serves as an interface between the blockchain API functionality
 * and the DB operations from `db/operation.ts` and also handles the right encoding of the keys
 */

export function DBSetTD(TD: BN, blockNumber: BN, blockHash: Buffer): DBOp {
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
export function DBSetBlockOrHeader(blockBody: Block | BlockHeader): DBOp[] {
  const header: BlockHeader =
    blockBody instanceof Block ? blockBody.header : blockBody;
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

  if (
    isGenesis ||
    (blockBody instanceof Block &&
      (blockBody.transactions.length || blockBody.uncleHeaders.length))
  ) {
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

export function DBSetHashToNumber(blockHash: Buffer, blockNumber: BN): DBOp {
  const blockNumber8Byte = bufBE8(blockNumber);
  return DBOp.set(DBTarget.HashToNumber, blockNumber8Byte, {
    blockHash
  });
}

export function DBSaveLookups(blockHash: Buffer, blockNumber: BN): DBOp[] {
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
export function DBSaveReceipts(
  receipts: Receipt[],
  blockHash: Buffer,
  blockNumber: BN
) {
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
export function DBSaveTxLookup(block: Block): DBOp[] {
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
export function DBSaveBloomBits(
  bit: number,
  section: BN,
  hash: Buffer,
  bits: Buffer
) {
  return DBOp.set(DBTarget.BloomBits, bits, { bit, section, hash });
}

/**
 * Create BloomBitsSectionCount operation
 * @param section - Section number
 * @returns  New operation
 */
export function DBSaveBloomBitsSectionCount(section: BN) {
  return DBOp.set(DBTarget.BloomBitsSectionCount, section.toString());
}

/**
 * Create a operation to delete BloomBitsSectionCount
 * @returns New operation
 */
export function DBDeleteBloomBitsSectionCount() {
  return DBOp.del(DBTarget.BloomBitsSectionCount);
}

/**
 * Create a operation to save snapshot account
 * @param accountHash - Account hash
 * @param serializedAccount - Serialized account
 * @returns New operation
 */
export function DBSaveSerializedSnapAccount(
  accountHash: Buffer,
  serializedAccount: Buffer
) {
  return DBOp.set(DBTarget.SnapAccount, serializedAccount, { accountHash });
}

/**
 * Create a operation to delete snapshot account
 * @param accountHash - Account hash
 * @returns New operation
 */
export function DBDeleteSnapAccount(accountHash: Buffer) {
  return DBOp.del(DBTarget.SnapAccount, { accountHash });
}

/**
 * Create a operation to save snapshot account storage
 * @param accountHash - Account hash
 * @param storageHash - Storage hash
 * @param storageValue - Storage value
 * @returns New operation
 */
export function DBSaveSnapStorage(
  accountHash: Buffer,
  storageHash: Buffer,
  storageValue: Buffer
) {
  return DBOp.set(DBTarget.SnapStorage, storageValue, {
    accountHash,
    storageHash
  });
}

/**
 * Create a operation to delete snapshot account storage
 * @param accountHash - Account hash
 * @param storageHash - Storage hash
 * @returns New operation
 */
export function DBDeleteSnapStorage(accountHash: Buffer, storageHash: Buffer) {
  return DBOp.del(DBTarget.SnapStorage, { accountHash, storageHash });
}

/**
 * Create a operation to save snapshot root
 * @param root
 * @returns New operation
 */
export function DBSaveSnapRoot(root: Buffer) {
  return DBOp.set(DBTarget.SnapRoot, root);
}

/**
 * Create a operation to delete snapshot root
 * @returns New operation
 */
export function DBDeleteSnapRoot() {
  return DBOp.del(DBTarget.SnapRoot);
}

/**
 * Create a operation to save snapshot journal
 * @param journal
 * @returns New operation
 */
export function DBSaveSnapJournal(journal: Buffer) {
  return DBOp.set(DBTarget.SnapJournal, journal);
}

/**
 * Create a operation to delete snapshot journal
 * @returns New operation
 */
export function DBDeleteSnapJournal() {
  return DBOp.del(DBTarget.SnapJournal);
}
/**
 * Create a operation to save snapshot generator
 * @param generator
 * @returns New operation
 */
export function DBSaveSnapGenerator(generator: Buffer) {
  return DBOp.set(DBTarget.SnapGenerator, generator);
}

/**
 * Create a operation to delete snapshot generator
 * @returns New operation
 */
export function DBDeleteSnapGenerator() {
  return DBOp.del(DBTarget.SnapGenerator);
}

/**
 * Create a operation to save snapshot disabled
 * @returns New operation
 */
export function DBSaveSnapDisabled() {
  return DBOp.set(DBTarget.SnapDisabled, [
    '42'.charCodeAt(0),
    '42'.charCodeAt(1)
  ]);
}

/**
 * Create a operation to delete snapshot disabled
 * @returns
 */
export function DBDeleteSnapDisabled() {
  return DBOp.del(DBTarget.SnapDisabled);
}

/**
 * Create a operation to save snapshot recovery
 * @returns
 */
export function DBSaveSnapRecoveryNumber(number: BN) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(number.toString()));
  return DBOp.set(DBTarget.SnapRecovery, buf);
}

/**
 * Create a operation to delete snapshot recovery
 * @returns
 */
export function DBDeleteSnapRecoveryNumber() {
  return DBOp.del(DBTarget.SnapRecovery);
}
/**
 * Create a operation to save snapshot sync progress
 * @param progress
 * @returns New operation
 */
export function DBSaveSnapSyncProgress(progress: Buffer) {
  return DBOp.set(DBTarget.SnapSyncProgress, progress);
}
