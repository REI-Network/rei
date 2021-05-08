import fs from 'fs';
import path from 'path';

export class FileCache {
  all: Array<string>;
  lastMod: number;

  constructor() {
    this.all = new Array<string>();
    this.lastMod = Date.now();
  }

  scan(keydir: string) {
    try {
      fs.readdirSync(keydir);
    } catch (error) {
      return [[], [], []];
    }
    const filestmp = fs.readdirSync(keydir);
    const files = filestmp.filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
    if (files.length == 0) {
      return;
    }
    let all = new Array<string>();
    let mods = new Array<string>();
    let newLastmode = Date.now();
    for (const fi of files) {
      let pathtmp = path.join(keydir, fi);
      all.push(pathtmp);
      const modified = fs.statSync(pathtmp).mtime.getTime();
      if (modified > this.lastMod) {
        mods.push(pathtmp);
      }
      if (modified > newLastmode) {
        newLastmode = modified;
      }
    }

    const deletes = this.all.filter((x) => !all.includes(x));
    const creates = all.filter((x) => this.all.includes(x));
    const updates = mods.filter((x) => !creates.includes(x));

    this.all = all;
    this.lastMod = newLastmode;
    return [creates, deletes, updates];
  }
}
