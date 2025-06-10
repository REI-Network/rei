import { Address, BN, toBuffer } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';

const coder = new AbiCoder();

// convert buffer to address
export function bufferToAddress(buf: Buffer) {
  return new Address(buf.slice(buf.length - 20));
}

// abi encode values by types
export function encode(types: string[], values: any[]) {
  if (types.length === 0) {
    return Buffer.from([]);
  }
  return toBuffer(coder.encode(types, values));
}

// decode int256 type
export function decodeInt256(buf: Buffer) {
  return new BN(coder.decode(['int256'], buf)[0].toString());
}

export function decodeBytes(buf: Buffer): string {
  return coder.decode(['bytes'], buf)[0];
}

/**
 * Encode validators id and priority to buffer
 * @param validators - validators id list
 * @param priorities - validators priority list
 * @returns buffer
 */
export function validatorsEncode(ids: BN[], priorities: BN[]): Buffer {
  if (ids.length !== priorities.length) {
    throw new Error('validators length not equal priorities length');
  }
  const buffer: Buffer[] = [];
  for (let i = 0; i < ids.length; i++) {
    // encode validator index
    const id = ids[i];
    const idBuffer = id.toBuffer();
    let bytes: number[];
    if (id.gten(223)) {
      bytes = [255 - idBuffer.length, ...idBuffer];
    } else {
      bytes = [...idBuffer];
    }
    // encode priority
    const priority = priorities[i];
    const priorityBytes = priority.toBuffer();
    const length = priorityBytes.length;
    const negativeFlag = priority.isNeg() ? 128 : 0;
    buffer.push(
      Buffer.from(bytes),
      Buffer.from([negativeFlag + length]),
      priorityBytes
    );
  }
  return Buffer.concat(buffer);
}

/**
 * Decode buffer to validators id list
 * @param buffer - buffer
 * @returns validators id list and validators priority list
 */
export function validatorsDecode(data: Buffer) {
  const ids: BN[] = [];
  const priorities: BN[] = [];
  for (let i = 0; i < data.length; i++) {
    // decode validator index
    const item = data[i];
    if (item >= 223) {
      const length = 255 - item;
      const bytes = data.slice(i + 1, i + 1 + length);
      ids.push(new BN(bytes));
      i += length;
    } else {
      ids.push(new BN(item));
    }
    // decode priority
    const prioritySign = data[i + 1];
    const isNeg = prioritySign >> 7 === 1;
    const length = isNeg ? prioritySign - 128 : prioritySign;
    const priorityBytes = data.slice(i + 2, i + 2 + length);
    let bn = new BN(priorityBytes);
    if (isNeg) bn = bn.neg();
    priorities.push(bn);
    i += length + 1;
  }
  return { ids, priorities };
}
