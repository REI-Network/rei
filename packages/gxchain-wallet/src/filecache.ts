import fs from 'fs';
import path from 'path';

export class FileCache {
  private all: string[] = [];
  private lastMod: number = Date.now();

  scan(keydir: string): [string[], string[], string[]] {
    try {
      const files = fs.readdirSync(keydir).filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
      if (files.length === 0) {
        return [[], [], []];
      }
      const all: string[] = [];
      const mods: string[] = [];
      let newLastmode = Date.now();
      for (const fi of files) {
        let fullPath = path.join(keydir, fi);
        all.push(fullPath);
        const modified = fs.statSync(fullPath).mtime.getTime();
        if (modified > this.lastMod) {
          mods.push(fullPath);
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
    } catch (err) {
      return [[], [], []];
    }
  }
}
