const errMissingData = new Error('missing bytes on input');
const errUnreferencedData = new Error('extra bytes on input');
const errExceededTarget = new Error('target data size exceeded');
const errZeroContent = new Error('zero byte in input content');

function compressBytes(data: number[]): number[] {
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
    if (data[0] == 0) {
      return [];
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
      nonZeroBitset[j / 8] |= 1 << (7 - (i % 8));
    }
    j++;
  }
  if (nonZeroBytes.length == 0) {
    return;
  }

  let temp = bitsetEncodeBytes(nonZeroBitset);
  temp.push(...nonZeroBytes);
  return temp;
}

function DecompressBytes(data: number[], target: number): [number[], Error?] {
  if (data.length > target) {
    return [[], errExceededTarget];
  }
  if (data.length == target) {
    const cpy = data;
    return [cpy];
  }
  return bitsetDecodeBytes(data, target);
}

function bitsetDecodeBytes(data: number[], target: number): [number[], Error?] {
  const [out, size, err] = bitsetDecodePartialBytes(data, target);
  if (err) {
    return [[], err];
  }
  if (size != data.length) {
    return [[], errUnreferencedData];
  }
  return [out];
}

function bitsetDecodePartialBytes(data: number[], target: number): [number[], number, Error?] {
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

  let [nonZeroBitset, ptr, error] = bitsetDecodePartialBytes(data, (target + 7) / 8);

  if (error) {
    return [[], ptr, error];
  }
  for (let i = 0; i < 8 * nonZeroBitset.length; i++) {
    const judement = nonZeroBitset[i / 8] & (1 << (7 - (i % 8)));
    if (judement != 0) {
      if (ptr >= data.length) {
        return [[], 0, errMissingData];
      }
      if (i >= decomp.length) {
        return [[], 0, errExceededTarget];
      }
      if (data[ptr] == 0) {
        return [[], 0, errZeroContent];
      }
      decomp[i] = data[ptr];
      ptr++;
    }
  }
  return [decomp, ptr];
}
