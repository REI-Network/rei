import { bufferToInt, intToBuffer, setLengthLeft, BN } from 'ethereumjs-util';
import { logger } from '@gxchain2/utils';
import { StateMachineMsg, StateMachineMsgFactory, StateMachineEndHeight } from '../state/types';
import { FileGroup, GroupFileReader } from './fileGroup';
import { crc32 } from './crc32';

const defaultFlushInterval = 2 * 1000;
const maxMsgSize = 1048576;

export interface WALOptions {
  path: string;
  flushInterval?: number;
}

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

  clear() {
    return runAndIgnoreErrors(() => {
      return this.group.clear();
    });
  }

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

  async write(message: StateMachineMsg, flush?: boolean) {
    const data = StateMachineMsgFactory.serializeMessage(message);
    if (data.length > maxMsgSize) {
      throw new Error('invalid data length');
    }

    const crc = crc32(data);
    const crcBuffer = intToBuffer(crc);
    if (crcBuffer.length !== 4) {
      throw new Error('invalid crc buffer length');
    }

    const lengthBuffer = setLengthLeft(intToBuffer(data.length), 4);
    if (lengthBuffer.length !== 4) {
      throw new Error('invalid length buffer length');
    }

    return !!(await runAndIgnoreErrors(async () => {
      await this.group.write(Buffer.concat([crcBuffer, lengthBuffer, data]), flush);
      return true;
    }));
  }

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

  newReader(index?: number) {
    return new WALReader(this.group.newReader(index));
  }
}

export class WALReader {
  private reader: GroupFileReader;

  constructor(reader: GroupFileReader) {
    this.reader = reader;
  }

  close() {
    return runAndIgnoreErrors(() => {
      return this.reader.close();
    });
  }

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
