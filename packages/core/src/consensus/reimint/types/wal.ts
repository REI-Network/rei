import { bufferToInt, intToBuffer, setLengthLeft, BN } from 'ethereumjs-util';
import { logger } from '@gxchain2/utils';
import { StateMachineMsg, StateMachineEndHeight } from './stateMessages';
import { StateMachineMsgFactory } from './stateMessageFactory';
import { FileGroup, GroupFileReader } from './fileGroup';
import { crc32 } from './crc32';

const defaultFlushInterval = 2 * 1000;
const maxMsgSize = 1048576;

export interface WALOptions {
  path: string;
  flushInterval?: number;
}

// run async function and ignore all errors
function runAndIgnoreErrors<T>(fn: () => Promise<T>): Promise<T | void> {
  return fn().catch(() => {});
}

export class WAL {
  private group: FileGroup;
  private flushInterval: number;
  private timeout?: NodeJS.Timeout;

  constructor(options: WALOptions) {
    this.group = new FileGroup({
      base: 'WAL',
      path: options.path
    });
    this.flushInterval = options.flushInterval ?? defaultFlushInterval;
  }

  private setTimeout() {
    if (this.group.isClosed) {
      return;
    }

    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      this.group
        .flush()
        .then(() => {
          this.setTimeout();
        })
        .catch((err) => {
          logger.error('WAL::setTimeout, catch error:', err);
          this.setTimeout();
        });
    }, this.flushInterval);
  }

  /**
   * Open WAL
   */
  async open() {
    try {
      await this.group.open();
    } catch (err) {
      // ignore all errors,
      // clear WAL dir and reopen
      await runAndIgnoreErrors(async () => {
        await this.group.clear();
        await this.group.open();
      });
    } finally {
      this.setTimeout();
    }
  }

  /**
   * Clear all files in the WAL directory
   */
  clear() {
    return runAndIgnoreErrors(() => {
      return this.group.clear();
    });
  }

  /**
   * Close WAL and release the file handler
   */
  async close() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    await runAndIgnoreErrors(async () => {
      await this.group.flush();
      await this.group.close();
    });
  }

  /**
   * Encode and write state machine message to WAL
   * @param message - State machine message
   * @param flush - Whether to flush to disk
   * @returns Whether succeed
   */
  async write(message: StateMachineMsg, flush?: boolean) {
    const data = StateMachineMsgFactory.serializeMessage(message);
    if (data.length > maxMsgSize) {
      throw new Error('invalid data length');
    }

    const crcBuffer = setLengthLeft(intToBuffer(crc32(data)), 4);
    const lengthBuffer = setLengthLeft(intToBuffer(data.length), 4);

    return !!(await runAndIgnoreErrors(async () => {
      await this.group.write(Buffer.concat([crcBuffer, lengthBuffer, data]), flush);
      return true;
    }));
  }

  /**
   * Search for target height EndHeightMessage from the beginning
   * @param height - Target height
   * @returns WALReader, if found
   */
  async searchForEndHeight(height: BN) {
    const reader = this.newReader();
    try {
      let message: StateMachineMsg | undefined;
      while ((message = await reader.read())) {
        if (message instanceof StateMachineEndHeight && message.height.eq(height)) {
          return reader;
        }
      }
      await reader.close();
    } catch (err) {
      // ignore all errors
      await reader.close();
    }
  }

  /**
   * Create a new WALReader
   * @param index
   * @returns WALReader
   */
  newReader() {
    return new WALReader(this.group.newReader());
  }
}

export class WALReader {
  private reader: GroupFileReader;

  constructor(reader: GroupFileReader) {
    this.reader = reader;
  }

  /**
   * Close WALReader
   */
  close() {
    return runAndIgnoreErrors(() => {
      return this.reader.close();
    });
  }

  /**
   * Read next state machine message from WAL,
   * if the state machine message doesn't exist, return undefined,
   * if the data is wrong, throw a error
   */
  async read(): Promise<StateMachineMsg | undefined> {
    const crcBuffer = Buffer.alloc(4);
    if (!(await this.reader.read(crcBuffer))) {
      // throw new Error('read failed');
      return;
    }
    const crc = bufferToInt(crcBuffer);

    const lengthBuffer = Buffer.alloc(4);
    if (!(await this.reader.read(lengthBuffer))) {
      throw new Error('read failed');
    }
    const length = bufferToInt(lengthBuffer);
    if (length > maxMsgSize) {
      throw new Error('invalid length');
    }

    const data = Buffer.alloc(length);
    if (!(await this.reader.read(data))) {
      throw new Error('read failed');
    }
    if (crc !== crc32(data)) {
      throw new Error('invalid data');
    }

    return StateMachineMsgFactory.fromSerializedMessage(data);
  }
}
