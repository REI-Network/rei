import { expect } from 'chai';
import { TimeoutQueue } from '../src';

describe('TimeoutQueue', () => {
  it('should set timeout succeed', async () => {
    const queue = new TimeoutQueue(1);

    let count = 0;
    for (let i = 0; i < 5; i++) {
      const id = queue.setTimeout(() => {
        count++;
      });
      expect(id).be.equal(Number.MIN_SAFE_INTEGER + i);
    }

    await new Promise((r) => setTimeout(r, 100));

    expect(count).be.equal(5);
  });

  it('should clear succeed', () => {
    const queue = new TimeoutQueue(1);

    let count = 0;
    for (let i = 0; i < 5; i++) {
      const id = queue.setTimeout(() => {
        count++;
      });
      expect(id).be.equal(Number.MIN_SAFE_INTEGER + i);
    }

    for (let i = 0; i < 5; i++) {
      expect(queue.clearTimeout(Number.MIN_SAFE_INTEGER + i)).be.true;
    }

    expect(queue.clearTimeout(100)).be.false;
  });
});
