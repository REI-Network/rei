import * as fs from 'fs/promises';
import path from 'path';
import Semaphore from 'semaphore-async-await';
import { logger } from '@rei-network/utils';

const defaultGroupCheckDuration = 5 * 1000;
const defaultHeadSizeLimit = 10 * 1024 * 1024; // 10MB
const defaultTotalSizeLimit = 200 * 1024 * 1024; // 200MB
const defaultMaxFilesToRemove = 40;

/**
 * Make group file path by index,
 * if index === maxIndex, return head path
 * @param _path - Path to group file dir
 * @param base - Group file base prefix
 * @param index - Group file index
 * @param maxIndex - Group file max index
 * @returns Group file path
 */
export function makeGroupFilePath(_path: string, base: string, index: number, maxIndex?: number) {
  if (maxIndex !== undefined && index === maxIndex) {
    return path.join(_path, base);
  }
  return path.join(_path, `${base}.${String(index).padStart(3, '0')}`);
}

export interface FileGroupOptions {
  // group file base prefix
  base: string;
  // path to group file dir
  path: string;
  // check duration, in each loop,
  // FileGroup will check head size limit
  // and total size limit
  groupCheckDuration?: number;
  // head size limit,
  // if the head size is greater than this limit,
  // FileGroup will rotate the head to the disk
  headSizeLimit?: number;
  // total size limit,
  // if the total file size is greater than this limit,
  // FileGroup will delete file from back to front
  totalSizeLimit?: number;
  // maximum number of files to be removed in each loop
  maxFilesToRemove?: number;
}

export class FileGroup {
  readonly base: string;
  readonly path: string;
  private groupCheckDuration: number;
  private headSizeLimit: number;
  private totalSizeLimit: number;
  private maxFilesToRemove: number;
  private _minIndex: number = 0;
  private _maxIndex: number = 0;
  private _isClosed = true;
  private lock = new Semaphore(1);
  private head?: fs.FileHandle;
  private timeout?: NodeJS.Timeout;

  constructor(options: FileGroupOptions) {
    this.base = options.base;
    this.path = options.path;
    this.groupCheckDuration = options.groupCheckDuration ?? defaultGroupCheckDuration;
    this.headSizeLimit = options.headSizeLimit ?? defaultHeadSizeLimit;
    this.totalSizeLimit = options.totalSizeLimit ?? defaultTotalSizeLimit;
    this.maxFilesToRemove = options.maxFilesToRemove ?? defaultMaxFilesToRemove;
  }

  /**
   * Is FileGroup closed
   */
  get isClosed() {
    return this._isClosed;
  }

  /**
   * Get current min index
   */
  get minIndex() {
    this.requireHead();
    return this._minIndex;
  }

  /**
   * Get current max index
   */
  get maxIndex() {
    this.requireHead();
    return this._maxIndex;
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  private requireHead() {
    if (!this.head) {
      throw new Error("head doesn't exsit");
    }
  }

  /**
   * Open file group
   */
  open() {
    return this.runWithLock(async () => {
      if (this.head) {
        throw new Error('head already exists');
      }
      const { minIndex, maxIndex } = await this.readGroupInfo();
      this._minIndex = minIndex;
      this._maxIndex = maxIndex;
      this.head = await fs.open(makeGroupFilePath(this.path, this.base, 0, 0), 'a');
      this._isClosed = false;
      this.setTimeout();
    });
  }

  /**
   * Close file group
   */
  close() {
    this._isClosed = true;
    return this.runWithLock(this._close);
  }

  private _close = async () => {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.head) {
      await this.head?.close();
      this.head = undefined;
    }
  };

  /**
   * Clear group file dir
   */
  clear() {
    return this.runWithLock(async () => {
      // close file handler
      if (!this._isClosed) {
        this._isClosed = true;
        await this._close();
      }

      // remove dir
      await fs.rm(this.path, { recursive: true, force: true });
      // make dir
      await fs.mkdir(this.path);
    });
  }

  /**
   * Write data to file group
   * @param data - Data
   * @param flush - Whether to flush to disk
   */
  write(data: Buffer, flush?: boolean) {
    return this.runWithLock(async () => {
      this.requireHead();
      await this.head!.write(data);
      if (flush) {
        await this.head!.sync();
      }
    });
  }

  /**
   * Flush to disk
   */
  flush() {
    return this.runWithLock(async () => {
      this.requireHead();
      await this.head!.sync();
    });
  }

  /**
   * Create a new group file reader
   * @returns Group file reader
   */
  newReader(index?: number) {
    return new GroupFileReader(this, index ?? this.minIndex);
  }

  /**
   * Read group info from file group dir
   * NOTE: minIndex and maxIndex may be different from `fileGroup.minIndex` and `fileGroup.maxIndex`
   * @returns Group info
   */
  async readGroupInfo() {
    const files = await fs.readdir(this.path);
    let minIndex = -1;
    let maxIndex = -1;
    let totalSize = 0;
    let headSize = 0;

    for (const file of files) {
      if (file === this.base) {
        // header
        const stats = await fs.stat(makeGroupFilePath(this.path, this.base, 0, 0));
        totalSize += stats.size;
        headSize = stats.size;
      } else if (file.startsWith(this.base)) {
        // flushed files
        const execArray = /^.+\.([0-9]{3,})$/.exec(file);
        if (execArray !== null && execArray.length === 2) {
          const strIndex = execArray[1];
          const index = Number(strIndex);
          if (!Number.isInteger(index)) {
            continue;
          }
          const _path = makeGroupFilePath(this.path, this.base, index);
          // check file name
          if (_path !== path.join(this.path, file)) {
            continue;
          }
          const stats = await fs.stat(_path);
          totalSize += stats.size;
          if (index > maxIndex) {
            maxIndex = index;
          }
          if (minIndex === -1 || index < minIndex) {
            minIndex = index;
          }
        }
      }
    }

    if (minIndex === -1) {
      minIndex = 0;
      maxIndex = 0;
    } else {
      // for head file
      maxIndex++;
    }

    return {
      minIndex,
      maxIndex,
      totalSize,
      headSize
    };
  }

  private setTimeout() {
    if (this._isClosed) {
      return;
    }

    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      this.tryToCheck()
        .then(() => {
          this.setTimeout();
        })
        .catch((err) => {
          logger.error('FileGroup::setTimeout, catch error:', err);
          if (this.head) {
            this.setTimeout();
          }
        });
    }, this.groupCheckDuration);
  }

  private tryToCheck() {
    return this.runWithLock(async () => {
      if (this.head) {
        await this.checkHeadSizeLimit();
        await this.checkTotalSizeLimit();
      }
    });
  }

  private async checkHeadSizeLimit() {
    if (this.headSizeLimit === 0) {
      return;
    }

    const headSize = (await this.head!.stat()).size;
    if (headSize > this.headSizeLimit) {
      // rotate head
      await this.head!.sync();
      await this.head!.close();
      const oldPath = makeGroupFilePath(this.path, this.base, 0, 0);
      const newPath = makeGroupFilePath(this.path, this.base, this._maxIndex, this._maxIndex + 1);
      await fs.rename(oldPath, newPath);
      this._maxIndex++;
      this.head = await fs.open(oldPath, 'a');
    }
  }

  private async checkTotalSizeLimit() {
    if (this.totalSizeLimit === 0) {
      return;
    }

    let { totalSize, minIndex, maxIndex } = await this.readGroupInfo();
    if (totalSize > this.totalSizeLimit) {
      for (let i = 0; i < this.maxFilesToRemove; i++) {
        const index = minIndex + i;
        if (index === maxIndex) {
          return;
        }
        const _path = makeGroupFilePath(this.path, this.base, index);
        const stats = await fs.stat(_path);
        await fs.rm(_path, { recursive: true, force: true });

        totalSize -= stats.size;
        if (totalSize <= this.totalSizeLimit) {
          return;
        }
      }
    }
  }
}

export class GroupFileReader {
  private index: number = 0;
  private group: FileGroup;
  private lock = new Semaphore(1);
  private position = 0;
  private file?: fs.FileHandle;

  constructor(group: FileGroup, index: number) {
    this.group = group;
    this.index = index;
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  private async tryOpenFile(index: number) {
    try {
      return await fs.open(makeGroupFilePath(this.group.path, this.group.base, index, this.group.maxIndex), 'r');
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async openFile() {
    let index = this.index;
    while (!this.file && index <= this.group.maxIndex) {
      this.file = await this.tryOpenFile((this.index = index++));
    }
    return !!this.file;
  }

  /**
   * Close reader
   */
  close() {
    return this.runWithLock(async () => {
      if (this.file) {
        await this.file.close();
        this.file = undefined;
        this.position = 0;
      }
    });
  }

  /**
   * Read data from group file
   * @param buf - The buffer that the data will be written to
   * @returns If the file data cannot fill the entire buffer, return false,
   *          otherwise, return true
   */
  read(buf: Buffer) {
    return this.runWithLock(async () => {
      let readLength = buf.length;
      while (readLength > 0) {
        if (!this.file && !(await this.openFile())) {
          return false;
        }

        const { bytesRead } = await this.file!.read(buf, buf.length - readLength, readLength, this.position);
        this.position += bytesRead;
        readLength -= bytesRead;

        if (readLength > 0) {
          await this.file!.close();
          this.file = undefined;
          this.position = 0;
          if (this.index + 1 > this.group.maxIndex) {
            return false;
          }
          this.index++;
        }
      }
      return true;
    });
  }

  /**
   * Get current group file index
   * @returns Group file index
   */
  getIndex() {
    return this.index;
  }

  /**
   * Set current group file index
   * @param index - Index
   */
  setIndex(index: number) {
    return this.runWithLock(async () => {
      this.index = index;
      if (this.file) {
        await this.file.close();
        this.file = undefined;
        this.position = 0;
      }
    });
  }

  /**
   * Copy reader instance
   */
  copy() {
    const reader = new GroupFileReader(this.group, this.index);
    reader.position = this.position;
    return reader;
  }
}
