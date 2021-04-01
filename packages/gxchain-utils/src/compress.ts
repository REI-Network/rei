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
