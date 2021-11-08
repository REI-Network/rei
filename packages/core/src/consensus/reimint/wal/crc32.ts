const crcTable: number[] = (() => {
  let c: number;
  const _crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crcTable[n] = c;
  }
  return _crcTable;
})();

export function crc32(buf: Buffer) {
  let crc = 0 ^ -1;

  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}
