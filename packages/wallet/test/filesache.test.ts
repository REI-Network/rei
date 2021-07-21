import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { FileCache } from '../src/filecache';

describe('FileCache', () => {
  let testdir: string;
  const filecache = new FileCache();
  const filesname = ['blue', 'yellow', 'white', 'red', 'purple'];
  const newcreate = 'black';
  const remove = ['blue', 'yellow'].sort();
  const change = ['white', 'red', 'purple'].sort();

  before(() => {
    testdir = path.join(__dirname, './test-dir-filecache');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
    filesname.forEach((color) => {
      const filename = path.join(testdir, color);
      fs.writeFileSync(filename, color);
    });
    filecache.scan(testdir);
  });

  it('should sacn created files correctly', () => {
    fs.writeFileSync(path.join(testdir, newcreate), newcreate);
    const result = filecache.scan(testdir);
    expect(result[1].length, 'creates length should be equal').be.equal(0);
    expect(result[2].length, 'creates length should be equal').be.equal(0);
    expect(result[0][0], 'created file name should be euqal').be.equal(path.join(testdir, newcreate));
  });

  it('should sacn deleted files correctly', () => {
    remove.forEach((color) => {
      fs.unlinkSync(path.join(testdir, color));
    });
    const result = filecache.scan(testdir);
    expect(result[0].length, 'creates length should be equal').be.equal(0);
    expect(result[2].length, 'creates length should be equal').be.equal(0);
    remove.forEach((color, i) => {
      expect(path.join(testdir, color), 'deleted file name should be equal').be.equal(result[1][i]);
    });
  });

  it('should scan updated files correctly', () => {
    change.forEach((color) => {
      fs.writeFileSync(path.join(testdir, color), color + 'new');
    });
    const result = filecache.scan(testdir);
    expect(result[0].length, 'creates length should be equal').be.equal(0);
    expect(result[1].length, 'deletes length should be equal').be.equal(0);
    change.forEach((color, i) => {
      expect(path.join(testdir, color), 'updated file name should be equal').be.equal(result[2][i]);
    });
  });

  after(() => {
    fs.rmdirSync(testdir, { recursive: true });
  });
});
