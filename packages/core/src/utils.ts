import { Address, BN } from 'ethereumjs-util';
import { PostByzantiumTxReceipt, TxReceipt } from '@rei-network/vm/dist/types';
import { Common } from '@rei-network/common';
import { CLIQUE_EXTRA_VANITY, Receipt, Log } from '@rei-network/structure';
import { hexStringToBN } from '@rei-network/utils';

export const EMPTY_HASH = Buffer.alloc(32);
export const EMPTY_ADDRESS = Address.zero();
export const EMPTY_EXTRA_DATA = Buffer.alloc(CLIQUE_EXTRA_VANITY);
export const EMPTY_MIX_HASH = Buffer.alloc(32);
export const EMPTY_NONCE = Buffer.alloc(8);

export const MAX_UINT64 = new BN(Buffer.from('ffffffffffffffff', 'hex'));

export function isEmptyAddress(address: Address) {
  return address.equals(EMPTY_ADDRESS);
}

export function isEmptyHash(hash: Buffer) {
  return hash.equals(EMPTY_HASH);
}

export function postByzantiumTxReceiptsToReceipts(receipts: TxReceipt[]) {
  return (receipts as PostByzantiumTxReceipt[]).map(
    (r) =>
      new Receipt(
        r.gasUsed,
        r.bitvector,
        r.logs.map((l) => new Log(l[0], l[1], l[2])),
        r.status
      )
  );
}

export function getGasLimitByCommon(common: Common): BN {
  const limit = common.param('gasConfig', 'gasLimit');
  return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
}

/**
 * encode validators index list to buffer
 * @param validators - validators index list
 * @returns buffer
 */
export function validatorsEncode(data: number[], priorities: BN[]): Buffer {
  let buffer = Buffer.from([]);
  for (let i = 0; i < data.length; i++) {
    let item = data[i];
    let bytes: number[] = [];
    if (item >= 223) {
      const data = intToBytesBigEndian(item);
      const length = data.length;
      bytes = [255 - length].concat(data);
    } else {
      bytes.push(item);
    }
    let priority = priorities[i];
    let priorityBytes = priorityToBytes(priority);
    buffer = Buffer.concat([buffer, Buffer.from(bytes), priorityBytes]);
  }
  //buffer[]
  return buffer;
}

/**
 * decode buffer to validators index list
 * @param buffer - buffer
 * @returns validators index list
 */
export function validatorsDecode(data: Buffer) {
  let indexList: number[] = [];
  let priorityList: BN[] = [];
  for (let i = 0; i < data.length; i++) {
    let item = Number(data[i]);
    if (item >= 223) {
      const length = 255 - item;
      const bytes = data.slice(i + 1, i + 1 + length);
      indexList.push(bytesToIntBigEndian(bytes));
      i += length;
    } else {
      indexList.push(item);
    }
    //decode priority
    const priorityLength = Number(data[i + 1]);
    const priorityBytes = data.slice(i + 2, i + 2 + priorityLength + 1);
    priorityList.push(bytesToPriority(priorityBytes));
    i += priorityLength + 2;
  }
  return { indexList, priorityList };
}

function intToBytesBigEndian(number: number) {
  var bytes: number[] = [];
  var i = 32;
  do {
    bytes[--i] = number & 255;
    number = number >> 8;
  } while (i);
  let start: number = 0;
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) {
      start = i;
      break;
    }
  }
  return bytes.slice(start);
}

function bytesToIntBigEndian(bytes: Buffer) {
  var val = 0;
  for (var i = 0; i < bytes.length; ++i) {
    val += bytes[i];
    if (i < bytes.length - 1) {
      val = val << 8;
    }
  }
  return val;
}

function priorityToBytes(bn: BN) {
  let itemBytes = bn.toBuffer();
  let length = Buffer.from([itemBytes.length]); // 1 byte signed
  let isNegative = Buffer.from([bn.isNeg() ? 1 : 0]);
  return Buffer.concat([length, isNegative, itemBytes]);
}

function bytesToPriority(bytes: Buffer) {
  let isNegative = bytes[0];
  let itemBytes = bytes.slice(1);
  let bn = new BN(itemBytes);
  if (isNegative) {
    bn = bn.neg();
  }
  return bn;
}
