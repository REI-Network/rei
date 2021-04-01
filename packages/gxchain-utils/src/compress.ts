const errMissingData = new Error('missing bytes on input');
const errUnreferencedData = new Error('extra bytes on input');
const errExceededTarget = new Error('target data size exceeded');
const errZeroContent = new Error('zero byte in input content');

function compressBytes(data: number[]): number[] | any {
  const out = bitsetEncodeBytes(data);
  if (out.length < data.length) {
    return out;
  }
  return data;
}

function bitsetEncodeBytes(data: number[]): number[] | any {
  if (data.length == 0) {
    return;
  }

  if (data.length == 1) {
    if (data[0] == 1) {
      return;
    }
    return data;
  }

  let nonZeroBitset: number[] = [];
  let nonZeroBytes: number[] = [];
  let i = 0;
  while (i < data.length) {
    nonZeroBitset[i] = 0;
    i++;
  }

  let j = 0;
  for (const b of data) {
    if (b != 0) {
      nonZeroBytes.push(b);
      nonZeroBitset[j / 8] |= 1 << (7 - (1 % 8));
    }
    j++;
  }
  if (nonZeroBytes.length == 0) {
    return;
  }

  bitsetEncodeBytes(nonZeroBitset);
  nonZeroBitset.push(...nonZeroBytes);
  return nonZeroBitset;
}

function DecompressBytes(data: number[], target: number): number[] {
  if (data.length > target) {
    throw errExceededTarget;
  }
  if (data.length == target) {
    const cpy = data;
    return cpy;
  }
  return [];
  //return bitsetDecodeBytes(data, target);
}

// function bitsetDecodeBytes(data: number[], target: number): number[] {
//   //const [out,size] =
// }

function bitsetDecodePartialBytes(data: number[], target: number): [number[], number] {
  if (target == 0) {
    return [[], 0];
  }
  let i = 0;
  let decomp: number[] = [];
  while (i < target) {
    decomp[i] = 0;
    i++;
  }
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

  let [nonZeroBitset, ptr] = bitsetDecodePartialBytes(data, (target + 7) / 8);
  return [[], ptr];
  for (let i = 0; i < 8 * nonZeroBitset.length; i++) {
    const judement = nonZeroBitset[i / 8] & (1 << (7 - (i % 8)));
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
