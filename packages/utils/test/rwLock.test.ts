import { expect } from 'chai';
import { RWLock } from '../src';

async function withUntil<T>(array: T[], count: number) {
  while (array.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('RWLock', () => {
  it('should read and write in order', async () => {
    const results: string[] = [];

    const lock = new RWLock();

    lock.read(async () => {
      results.push('read 0 start');
      await new Promise((resolve) => setTimeout(resolve, 200));
      results.push('read 0 end');
    });

    setTimeout(() => {
      lock.write(async () => {
        results.push('write 1 start');
        await new Promise((resolve) => setTimeout(resolve, 400));
        results.push('write 1 end');
      });

      lock.read(async () => {
        results.push('read 1 start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push('read 1 end');
      });

      lock.read(async () => {
        results.push('read 2 start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push('read 2 end');
      });

      lock.read(async () => {
        results.push('read 3 start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push('read 3 end');
      });
    }, 100);

    await withUntil(results, 10);

    expect(results).to.deep.equal([
      'read 0 start',
      'read 0 end',
      'write 1 start',
      'write 1 end',
      'read 1 start',
      'read 2 start',
      'read 3 start',
      'read 1 end',
      'read 2 end',
      'read 3 end'
    ]);
  });

  it('should read and write in order and timeout', async () => {
    const results: string[] = [];

    const lock = new RWLock();

    lock.read(async () => {
      results.push('read 0 start');
      await new Promise((resolve) => setTimeout(resolve, 200));
      results.push('read 0 end');
    });

    lock.read(async () => {
      results.push('read 1 start');
      await new Promise((resolve) => setTimeout(resolve, 200));
      results.push('read 1 end');
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    lock.write(async () => {
      results.push('write 1 start');
      await new Promise((resolve) => setTimeout(resolve, 400));
      results.push('write 1 end');
    });

    const result = await lock
      .read(async () => {
        results.push('read 2 start');
        await new Promise((resolve) => setTimeout(resolve, 200));
        results.push('read 2 end');
      }, 300)
      .then(() => true)
      .catch(() => false);

    await withUntil(results, 6);

    expect(result, 'should timeout').to.be.false;

    expect(results).to.deep.equal([
      'read 0 start',
      'read 1 start',
      'read 0 end',
      'read 1 end',
      'write 1 start',
      'write 1 end'
    ]);
  });
});
