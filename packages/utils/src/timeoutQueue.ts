type TimeoutInfo = {
  id: number;
  awakeTimestamp: number;
  cb(): void;
};

/**
 * TimeoutQueue is used to process multiple timers with the same time interval in batches,
 * which can save resource consumption
 */
export class TimeoutQueue {
  private id: number = Number.MIN_SAFE_INTEGER;
  private duration: number;
  private queue: TimeoutInfo[] = [];
  private timeout?: NodeJS.Timeout;

  constructor(duration: number) {
    this.duration = duration;
  }

  private incrementId() {
    const incrementId = this.id++;
    if (this.id >= Number.MAX_SAFE_INTEGER) {
      this.id = Number.MIN_SAFE_INTEGER;
    }
    return incrementId;
  }

  private schedule() {
    if (this.timeout === undefined && this.queue.length > 0) {
      let duration = this.queue[0].awakeTimestamp - Date.now();
      if (duration < 0) {
        duration = 0;
      }
      this.timeout = setTimeout(this.onTimeout, duration);
    }
  }

  private onTimeout = () => {
    this.timeout = undefined;
    const now = Date.now();
    let i = 0;
    for (; i < this.queue.length; i++) {
      const ti = this.queue[i];
      if (ti.awakeTimestamp <= now) {
        ti.cb();
      }
    }
    this.queue.splice(0, i);
    this.schedule();
  };

  /**
   * Add a timer callback to the queue
   * @param cb
   * @returns Callback id
   */
  setTimeout(cb: () => void) {
    const id = this.incrementId();
    this.queue.push({
      id,
      awakeTimestamp: Date.now() + this.duration,
      cb
    });
    this.schedule();
    return id;
  }

  /**
   * Clear callback by id
   * @param id
   * @returns Is the clearing successful
   */
  clearTimeout(id: number) {
    const index = this.queue.findIndex(({ id: _id }) => id === _id);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    if (index === 0 && this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.schedule();
    }
    return true;
  }
}
