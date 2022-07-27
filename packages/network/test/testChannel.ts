export class testChannel<T> {
  private _bufs: T[] = [];
  private abort: boolean = false;
  constructor() {}
  send(data: T) {
    this._bufs.push(data);
  }

  async *data(): AsyncGenerator<T> {
    while (true && !this.abort) {
      if (this._bufs.length === 0) {
        await new Promise((r) => {
          setTimeout(r, 1000);
        });
      } else {
        yield this._bufs.shift()!;
      }
    }
  }

  close() {
    this.abort = true;
  }
}

async function handlerData(database: AsyncGenerator<Buffer>) {
  for await (const data of database) {
    console.log(data?.toString());
  }
}

async function main() {
  const c = new testChannel<Buffer>();
  handlerData(c.data());
  setTimeout(() => {
    c.send(Buffer.from('LELE'));
  }, 1000);
  setTimeout(() => {
    c.close();
  }, 3000);
}

// main();
