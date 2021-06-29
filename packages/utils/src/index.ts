import { BN } from 'ethereumjs-util';
import tracer from 'tracer';

interface Constructor<T = {}> {
  new (...args: any[]): T;
}

/**
 * This function implements multiple inheritance
 * @param mix1 The first parameter to be inherited
 * @param mix2 The second  parameter to be inherited
 * @returns The result after multiple inheritance
 */
export function mixin<T1 extends Constructor, T2 extends Constructor>(mix1: T1, mix2: T2): new (...args: any[]) => InstanceType<T1> & InstanceType<T2> {
  const mixinProps = (target, source) => {
    Object.getOwnPropertyNames(source).forEach((prop) => {
      if (/^constructor$/.test(prop)) {
        return;
      }
      Object.defineProperty(target, prop, Object.getOwnPropertyDescriptor(source, prop)!);
    });
  };

  let ctor;
  if (mix1 && typeof mix1 === 'function') {
    ctor = class extends mix1 {
      constructor(...props) {
        super(...props);
      }
    };
    mixinProps(ctor.prototype, mix2.prototype);
  } else {
    ctor = class {};
  }
  return ctor;
}

/**
 * Generate random integers according to the given range
 * @param min Minimum limit
 * @param max Maximum limit
 * @returns The random number
 */
export function getRandomIntInclusive(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  if (max < min) {
    throw new Error('The maximum value should be greater than the minimum value');
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Convert hex string type to buffer type
 * @param hex Hex string to be converted
 * @returns Converted buffer type data
 */
export function hexStringToBuffer(hex: string): Buffer {
  return hex.indexOf('0x') === 0 ? Buffer.from(hex.substr(2), 'hex') : Buffer.from(hex, 'hex');
}

/**
 * Convert hex string type to BN type
 * @param hex Hex string to be converted
 * @returns Converted BN type data
 */
export function hexStringToBN(hex: string): BN {
  return hex.indexOf('0x') === 0 ? new BN(hex.substr(2), 'hex') : new BN(hex, 'hex');
}

export const logger = tracer.colorConsole({
  format: '{{title}} [{{timestamp}}] {{message}}',
  level: 'detail',
  methods: ['detail', 'debug', 'info', 'warn', 'error', 'silent'],
  dateformat: 'mm-dd|HH:MM:ss.L',
  preprocess: (data) => {
    data.title = data.title.toUpperCase();
    if (data.title.length < 5) {
      data.title += ' '.repeat(5 - data.title.length);
    }
  }
});

export { setLevel } from 'tracer';

export * from './abort';
export * from './channel';
export * from './functionalmap';
export * from './compress';
