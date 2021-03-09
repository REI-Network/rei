import { BN } from 'ethereumjs-util';
import tracer from 'tracer';

interface Constructor<T = {}> {
  new (...args: any[]): T;
}

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
    ctor = class extends (
      mix1
    ) {
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

export function getRandomIntInclusive(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function hexStringToBuffer(hex: string): Buffer {
  return hex.indexOf('0x') === 0 ? Buffer.from(hex.substr(2), 'hex') : Buffer.from(hex, 'hex');
}

export function hexStringToBN(hex: string): BN {
  return hex.indexOf('0x') === 0 ? new BN(hex.substr(2), 'hex') : new BN(hex, 'hex');
}

export const logger = tracer.colorConsole({
  format: '[{{title}}][{{timestamp}}] {{message}}'
});

export * from './abort';
export * from './priorityqueue';
export * from './asyncnext';
export * from './functionalmap';
export * from './semaphorelock';
