import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { FileCache } from '../src/filecache';

describe('FileCache', () => {
  let testdir: string;
  const filecache = new FileCache();
  const filesname = ['blue', 'yellow', 'white', 'red', 'purple'];
  const newcreate = 'black';
  const remove = ['blue', 'yellow'];
  const change = ['white', 'red', 'purple'];

  before(() => {
    testdir = path.join(__dirname, './test-dir-filecache');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
  });

  it('should scan files correctly', () => {
    filesname.forEach((color) => {
      const filename = path.join(testdir, color);
      fs.writeFileSync(filename, color);
    });
    filecache.scan(testdir);
    fs.writeFileSync(path.join(testdir, newcreate), newcreate);
    remove.forEach((color) => {
      fs.unlinkSync(path.join(testdir, color));
    });
    change.forEach((color) => {
      fs.writeFileSync(path.join(testdir, color), color + 'new');
    });
    const result = filecache.scan(testdir);
    expect(result[0].length, 'creates length should be equal').be.equal(1);
    expect(result[1].length, 'deletes length should be equal').be.equal(2);
    expect(result[2].length, 'updates length should be equal').be.equal(3);
  });

  after(() => {
    fs.rmdirSync(testdir, { recursive: true });
  });
});
