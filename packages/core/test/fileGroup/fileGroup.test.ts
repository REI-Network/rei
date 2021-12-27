import * as fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { expect } from 'chai';
import { FileGroup, GroupFileReader, makeGroupFilePath } from '../../src/consensus/reimint/wal';

class MockFileGroup {
  readonly path: string;
  readonly base: string;
  readonly maxIndex: number;

  constructor(path: string, base: string, maxIndex: number) {
    this.path = path;
    this.base = base;
    this.maxIndex = maxIndex;
  }
}

class MockBytes {
  private content: string = '';

  append(str: string) {
    this.content += str;
  }

  read(length: number) {
    const result = this.content.substr(0, length);
    this.content = this.content.substr(length);
    return result;
  }
}

const testDir = path.join(__dirname, 'test-dir');
const testBase = 'wal';
const testMaxIndex = 10;
const bytes = new MockBytes();

const clearup = async () => {
  try {
    await fs.access(testDir);
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (err) {
    // ignore all errors
  }
};

const writeData = async (index: number) => {
  const content = `${index}|0123456789`;
  await fs.writeFile(makeGroupFilePath(testDir, testBase, index, testMaxIndex), content);
  bytes.append(content);
};

describe('GroupFileReader', () => {
  const reader = new GroupFileReader(new MockFileGroup(testDir, testBase, testMaxIndex) as any, 0);

  before(async () => {
    await clearup();
    await fs.mkdir(testDir);
    // create test data file, 0 and 3, 4, 5, ... 12
    await writeData(0);
    for (let i = 3; i < 10; i++) {
      await writeData(i);
    }
  });

  it('should read successfully(1)', async () => {
    const buf = Buffer.alloc(5);
    expect(await reader.read(buf), 'should read successfully').be.true;
    expect(buf.toString(), 'buffer content should be correct').be.equal(bytes.read(5));
  });

  it('should read successfully(2)', async () => {
    const buf = Buffer.alloc(5);
    expect(await reader.read(buf), 'should read successfully').be.true;
    expect(buf.toString(), 'buffer content should be correct').be.equal(bytes.read(5));
  });

  it('should read successfully(3)', async () => {
    const buf = Buffer.alloc(5);
    expect(await reader.read(buf), 'should read successfully').be.true;
    expect(buf.toString(), 'buffer content should be correct').be.equal(bytes.read(5));
  });

  it('should read successfully(4)', async () => {
    const buf = Buffer.alloc(24);
    expect(await reader.read(buf), 'should read successfully').be.true;
    expect(buf.toString(), 'buffer content should be correct').be.equal(bytes.read(24));
  });

  it('should read successfully(5)', async () => {
    const buf = Buffer.alloc(57);
    expect(await reader.read(buf), 'should read successfully').be.true;
    expect(buf.toString(), 'buffer content should be correct').be.equal(bytes.read(57));
  });

  it('should read faild', async () => {
    const buf = Buffer.alloc(1);
    expect(await reader.read(buf), 'should read successfully').be.false;
  });

  it('should close successfully', async () => {
    await reader.close();
  });

  after(async () => {
    await clearup();
  });
});

describe('FileGroup', () => {
  const groupCheckDuration = 300;
  const fileGroup = new FileGroup({
    path: testDir,
    base: testBase,
    groupCheckDuration,
    headSizeLimit: 10,
    totalSizeLimit: 100,
    maxFilesToRemove: 2
  });

  before(async () => {
    await clearup();
    await fs.mkdir(testDir);
    // create test data file, from 0 to 2
    for (let i = 0; i < 3; i++) {
      await writeData(i);
    }
  });

  it('should read group info correctly', async () => {
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(3);
    expect(info.totalSize, 'totalSize should be correct').be.equal(36);
    expect(info.headSize, 'headSize should be correct').be.equal(0);
  });

  it('should open successfully', async () => {
    await fileGroup.open();
    expect(fileGroup.minIndex, 'minIndex should be correct').be.equal(0);
    expect(fileGroup.maxIndex, 'maxIndex should be correct').be.equal(3);
  });

  it('should write successfully(1)', async () => {
    await fileGroup.write(crypto.randomBytes(36), true);
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(3);
    expect(info.totalSize, 'totalSize should be correct').be.equal(72);
    expect(info.headSize, 'headSize should be correct').be.equal(36);
  });

  it('should rotate successfully', async () => {
    await new Promise((r) => setTimeout(r, groupCheckDuration + 10));
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(4);
    expect(info.totalSize, 'totalSize should be correct').be.equal(72);
    expect(info.headSize, 'headSize should be correct').be.equal(0);
  });

  it('should write successfully(2)', async () => {
    await fileGroup.write(crypto.randomBytes(9), true);
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(4);
    expect(info.totalSize, 'totalSize should be correct').be.equal(81);
    expect(info.headSize, 'headSize should be correct').be.equal(9);
  });

  it("shouldn't rotate", async () => {
    await new Promise((r) => setTimeout(r, groupCheckDuration + 10));
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(4);
    expect(info.totalSize, 'totalSize should be correct').be.equal(81);
    expect(info.headSize, 'headSize should be correct').be.equal(9);
  });

  it('should write successfully(3)', async () => {
    await fileGroup.write(crypto.randomBytes(100), true);
    const info = await fileGroup.readGroupInfo();
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(4);
    expect(info.totalSize, 'totalSize should be correct').be.equal(181);
    expect(info.headSize, 'headSize should be correct').be.equal(109);
  });

  it('should remove successfully(1)', async () => {
    // current:
    // index: 4, size: 109 bytes
    // index: 3, size: 36 bytes
    // index: 2, size: 12 bytes
    // index: 1, size: 12 bytes
    // index: 0, size: 12 bytes
    await new Promise((r) => setTimeout(r, groupCheckDuration + 10));
    // current:
    // index: 4, size: 109 bytes
    // index: 3, size: 36 bytes
    // index: 2, size: 12 bytes
    //
    // because total size is greater than totalSizeLimit,
    // but maxFilesToRemove = 2
    const info = await fileGroup.readGroupInfo();
    expect(fileGroup.minIndex, 'minIndex should be correct').be.equal(0);
    expect(fileGroup.maxIndex, 'maxIndex should be correct').be.equal(5);
    expect(info.minIndex, 'minIndex should be correct').be.equal(2);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(5);
    expect(info.totalSize, 'totalSize should be correct').be.equal(157);
    expect(info.headSize, 'headSize should be correct').be.equal(0);
  });

  it('should remove successfully(2)', async () => {
    // current:
    // index: 4, size: 109 bytes
    // index: 3, size: 36 bytes
    // index: 2, size: 12 bytes
    await new Promise((r) => setTimeout(r, groupCheckDuration + 10));
    // current:
    // index: 4, size: 109 bytes
    // same reason as above
    const info = await fileGroup.readGroupInfo();
    expect(fileGroup.minIndex, 'minIndex should be correct').be.equal(0);
    expect(fileGroup.maxIndex, 'maxIndex should be correct').be.equal(5);
    expect(info.minIndex, 'minIndex should be correct').be.equal(4);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(5);
    expect(info.totalSize, 'totalSize should be correct').be.equal(109);
    expect(info.headSize, 'headSize should be correct').be.equal(0);
  });

  it('should remove successfully(3)', async () => {
    // current:
    // index: 4, size: 109 bytes
    await new Promise((r) => setTimeout(r, groupCheckDuration + 10));
    // current:
    // same reason as above
    const info = await fileGroup.readGroupInfo();
    expect(fileGroup.minIndex, 'minIndex should be correct').be.equal(0);
    expect(fileGroup.maxIndex, 'maxIndex should be correct').be.equal(5);
    expect(info.minIndex, 'minIndex should be correct').be.equal(0);
    expect(info.maxIndex, 'maxIndex should be correct').be.equal(0);
    expect(info.totalSize, 'totalSize should be correct').be.equal(0);
    expect(info.headSize, 'headSize should be correct').be.equal(0);
  });

  it('should close successfully', async () => {
    await fileGroup.close();
  });

  after(async () => {
    await clearup();
  });
});
