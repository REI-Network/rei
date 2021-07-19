const errMissingData = new Error('missing bytes on input');
const errUnreferencedData = new Error('extra bytes on input');
const errExceededTarget = new Error('target data size exceeded');
const errZeroContent = new Error('zero byte in input content');

/**
 * The method is to compress buffer data
 * @param data - The data to be compressed
 * @returns If the compressed data is less than the original
 * length after compression, otherwise return to the original data
 */
export function compressBytes(data: Buffer): Buffer {
  const out = bitsetEncodeBytes(data);
  if (out && out.length < data.length) {
    return out;
  }
  return data;
}

/**
 * Bit compress method, 8 bits are compressed as a group
 * @param data - The data to be compressed
 * @returns Return the compressed data, or undefined if error
 */
function bitsetEncodeBytes(data: Buffer): Buffer | undefined {
  if (data.length === 0) {
    return;
  }

  if (data.length === 1) {
    if (data[0] === 0) {
      return;
    }
    return data;
  }

  const nonZeroBitset: Buffer = Buffer.alloc(Math.ceil(data.length / 8)).fill(0);
  const nonZeroBytes: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) {
      nonZeroBytes.push(data[i]);
      nonZeroBitset[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
    }
  }

  if (nonZeroBytes.length === 0) {
    return;
  }

  const result = bitsetEncodeBytes(nonZeroBitset);
  if (!result) {
    return;
  }
  return Buffer.concat([result, Buffer.from(nonZeroBytes)]);
}

/**
 * Decompress data according to a given length
 * @param data - Data that needs to be decompressed
 * @param target - The length that the data should have after decompression
 * @returns Decompressed data
 */
export function decompressBytes(data: Buffer, target: number) {
  if (data.length > target) {
    throw errExceededTarget;
  }
  if (data.length === target) {
    return data;
  }
  return bitsetDecodeBytes(data, target);
}

/**
 * Determine whether the decompressed data meets the length requirement
 * @param data - Data that needs to be decompressed
 * @param target - The length that the data should have after decompression
 * @returns Decompressed data
 */
function bitsetDecodeBytes(data: Buffer, target: number) {
  const [out, size] = bitsetDecodePartialBytes(data, target);
  if (size !== data.length) {
    throw errUnreferencedData;
  }
  return out;
}

/**
 * The underlying implementation of the decompression method
 * @param data - Data that needs to be decompressed
 * @param target - The length that the data should have after decompression
 * @returns Decompressed data
 */
function bitsetDecodePartialBytes(data: Buffer, target: number): [Buffer, number] {
  if (target === 0) {
    return [Buffer.alloc(0), 0];
  }

  const decomp = Buffer.alloc(target).fill(0);

  if (data.length === 0) {
    return [decomp, 0];
  }
  if (target === 1) {
    decomp[0] = data[0];
    if (data[0] !== 0) {
      return [decomp, 1];
    }
    return [decomp, 0];
  }

  let [nonZeroBitset, ptr] = bitsetDecodePartialBytes(data, Math.ceil(target / 8));

  for (let i = 0; i < 8 * nonZeroBitset.length; i++) {
    const judement = nonZeroBitset[Math.floor(i / 8)] & (1 << (7 - (i % 8)));
    if (judement !== 0) {
      if (ptr >= data.length) {
        throw errMissingData;
      }
      if (i >= decomp.length) {
        throw errExceededTarget;
      }
      if (data[ptr] === 0) {
        throw errZeroContent;
      }
      decomp[i] = data[ptr];
      ptr++;
    }
  }
  return [decomp, ptr];
}
