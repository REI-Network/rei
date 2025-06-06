import { BN, toBuffer } from 'ethereumjs-util';

interface Constructor<T = {}> {
  new (...args: any[]): T;
}

/**
 * This function implements multiple inheritance
 * @param mix1 - The first parameter to be inherited
 * @param mix2 - The second  parameter to be inherited
 * @returns The result after multiple inheritance
 */
export function mixin<T1 extends Constructor, T2 extends Constructor>(
  mix1: T1,
  mix2: T2
): new (...args: any[]) => InstanceType<T1> & InstanceType<T2> {
  const mixinProps = (target, source) => {
    Object.getOwnPropertyNames(source).forEach((prop) => {
      if (/^constructor$/.test(prop)) {
        return;
      }
      Object.defineProperty(
        target,
        prop,
        Object.getOwnPropertyDescriptor(source, prop)!
      );
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
 * @param min - Minimum limit
 * @param max - Maximum limit
 * @returns The random number
 */
export function getRandomIntInclusive(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  if (max < min) {
    throw new Error(
      'The maximum value should be greater than the minimum value'
    );
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Run function and ignore all errors
 * @param fn - Function
 * @returns Funtion result or undefined(if something goes wrong)
 */
export function ignoreError<T>(p?: Promise<T>): Promise<void | T> | undefined {
  return p && p.catch((err) => {});
}

/**
 * Convert hex string to buffer
 * @param hex - Hex string to be converted
 * @returns Buffer
 */
export function hexStringToBuffer(hex: string): Buffer {
  return hex.startsWith('0x') ? toBuffer(hex) : toBuffer('0x' + hex);
}

/**
 * Convert hex string to BN
 * @param hex - Hex string to be converted
 * @returns BN
 */
export function hexStringToBN(hex: string): BN {
  return hex.startsWith('0x')
    ? new BN(hex.substr(2), 'hex')
    : new BN(hex, 'hex');
}

/**
 * Get current timestamp
 */
export function nowTimestamp() {
  return Math.floor(Date.now() / 1000);
}
