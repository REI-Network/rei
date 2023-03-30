import { expect, assert } from 'chai';
import { LimitedConcurrency } from '../../src/sync/full';

enum Status {
  Unknown,
  Started,
  Completed
}

class MockTask {
  readonly index: number;
  readonly timeout: number;
  status: Status = Status.Unknown;

  constructor(index: number, timeout: number) {
    this.index = index;
    this.timeout = timeout;
  }

  async execute() {
    this.status = Status.Started;
    await new Promise<number>((r) => {
      setTimeout(r, this.timeout);
    });
    this.status = Status.Completed;
  }
}

const newConcurrency = async (limit: LimitedConcurrency, task: MockTask, wait = false) => {
  const { promise } = await limit.newConcurrency(async () => {
    await task.execute();
  });
  if (wait) {
    await promise;
  }
  return { promise };
};

function shouldFailed(fn: () => void, message?: string) {
  try {
    fn();
    assert.fail();
  } catch (err: any) {
    if (message) {
      expect(err.message, 'error message should be equal').be.equal(message);
    }
  }
}

describe('LimitedConcurrency', () => {
  it('should contructor failed', () => {
    shouldFailed(() => {
      new LimitedConcurrency(0);
    });
  });

  it('should work fine(1)', async () => {
    const limit = new LimitedConcurrency(1);
    const task0 = new MockTask(0, 100);
    const { promise } = await newConcurrency(limit, task0);
    expect(task0.status).be.equal(Status.Started);
    await promise;
    expect(task0.status).be.equal(Status.Completed);
  });

  it('should work fine(2)', async () => {
    const limit = new LimitedConcurrency(5);
    const promises: Promise<void>[] = [];
    const tasks: MockTask[] = [];

    for (let i = 0; i < 5; i++) {
      const task = new MockTask(i, 100);
      promises.push((await newConcurrency(limit, task)).promise);
      tasks.push(task);
      expect(task.status).be.equal(Status.Started);
    }

    const task = new MockTask(5, 100);
    const p = newConcurrency(limit, task);
    expect(task.status).be.equal(Status.Unknown);
    tasks.push(task);

    await Promise.all(promises);
    const { promise } = await p;

    tasks.forEach((task, i) => {
      if (i !== 5) {
        expect(task.status).be.equal(Status.Completed);
      } else {
        expect(task.status).be.equal(Status.Started);
      }
    });

    await promise;

    expect(task.status).be.equal(Status.Completed);
  });

  it('should finish successfully', async () => {
    const limit = new LimitedConcurrency(5);
    const tasks: MockTask[] = [];

    for (let i = 0; i < 10; i++) {
      const task = new MockTask(i, 100);
      newConcurrency(limit, task);
      tasks.push(task);
    }

    await limit.finished();

    tasks.forEach((task) => {
      expect(task.status).be.equal(Status.Completed);
    });
  });
});
