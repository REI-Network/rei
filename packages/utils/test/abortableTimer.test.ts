import { assert, expect } from 'chai';
import { AbortableTimer } from '../src';

describe('AbortableTimer', () => {
  it('should wait succeed', async () => {
    await new AbortableTimer().wait(1);
  });

  it('should wait failed when timer has started', async () => {
    const timer = new AbortableTimer();
    timer.wait(1);

    try {
      await timer.wait(1);
      assert.fail('should fail');
    } catch (err) {
      // ignore
    }
  });

  it('should abort succeed', async () => {
    const timer = new AbortableTimer();
    const promise = timer.wait(1000);
    timer.abort();

    const startAt = Date.now();
    await promise;
    expect(Date.now() - startAt < 1000).be.true;
  });
});
