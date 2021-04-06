const errMissingData = new Error('missing bytes on input');
const errUnreferencedData = new Error('extra bytes on input');
const errExceededTarget = new Error('target data size exceeded');
const errZeroContent = new Error('zero byte in input content');

export function compressBytes(data: Buffer): Buffer | undefined {
  const out = bitsetEncodeBytes(data);
  if (!out) {
    return;
  }
  if (out.length < data.length) {
    return out;
  }
  return data;
}

function bitsetEncodeBytes(data: Buffer): Buffer | undefined {
  if (data.length === 0) {
    return;
  }

  if (data.length === 1) {
    if (data[0] == 0) {
      return;
    }
    return data;
  }

  const nonZeroBitset: Buffer = Buffer.alloc(Math.round((data.length + 7) / 8)).fill(0);
  const nonZeroBytes: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i] != 0) {
      nonZeroBytes.push(data[i]);
      nonZeroBitset[Math.round(i / 8)] |= 1 << (7 - (i % 8));
    }
  }

  if (nonZeroBytes.length == 0) {
    return;
  }

  const result = bitsetEncodeBytes(nonZeroBitset);
  if (!result) {
    return;
  }
  return Buffer.concat([result, Buffer.from(nonZeroBytes)]);
}

export function decompressBytes(data: Buffer, target: number) {
  if (data.length > target) {
    throw errExceededTarget;
  }
  if (data.length == target) {
    const cpy = data;
    return cpy;
  }
  return bitsetDecodeBytes(data, target);
}

function bitsetDecodeBytes(data: Buffer, target: number) {
  const [out, size] = bitsetDecodePartialBytes(data, target);
  if (size != data.length) {
    throw errUnreferencedData;
  }
  return out;
}

function bitsetDecodePartialBytes(data: Buffer, target: number): [Buffer, number] {
  if (target == 0) {
    return [Buffer.from(''), 0];
  }

  const decomp = Buffer.alloc(target).fill(0);

  if (data.length == 0) {
    return [decomp, 0];
  }
  if (target == 1) {
    decomp[0] = data[0];
    if (data[0] != 0) {
      return [decomp, 1];
    }
    return [decomp, 0];
  }

  let [nonZeroBitset, ptr] = bitsetDecodePartialBytes(data, Math.round((target + 7) / 8));

  for (let i = 0; i < 8 * nonZeroBitset.length; i++) {
    const judement = nonZeroBitset[Math.round(i / 8)] & (1 << (7 - (i % 8)));
    if (judement != 0) {
      if (ptr >= data.length) {
        throw errMissingData;
      }
      if (i >= decomp.length) {
        throw errExceededTarget;
      }
      if (data[ptr] == 0) {
        throw errZeroContent;
      }
      decomp[i] = data[ptr];
      ptr++;
    }
  }
  return [decomp, ptr];
}
