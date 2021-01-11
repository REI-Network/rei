import CID from 'cids';
import multihashing from 'multihashing-async';

export const stringToCID = async (str: string) => {
  const bytes = new TextEncoder().encode(str);
  const hash = await multihashing(bytes, 'sha2-256');
  return new CID(1, 'keccak-256', hash);
};

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

export * from './abort';
export * from './priorityqueue';
export * from './asyncnext';
