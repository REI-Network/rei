import EventEmitter from 'events';
import { expect } from 'chai';
import { Service, Endpoint } from './mock';
import { getRandomIntInclusive } from '@rei-network/utils';

describe('NetworkManager', () => {
  let service: Service;

  async function batchCreateNodes(count: number) {
    if (count <= 1) {
      throw new Error('invalid count');
    }
    const bootnode = await service.createEndpoint();
    const bootnodeENR = bootnode.discv5.localEnr.encodeTxt();
    const nodes: Endpoint[] = [bootnode];
    for (let i = 0; i < count - 1; i++) {
      nodes.push(await service.createEndpoint([bootnodeENR], true));
    }
    return nodes;
  }

  function randomPick<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('empty array');
    }
    return array[getRandomIntInclusive(0, array.length - 1)];
  }

  function check(emitter: EventEmitter, event: string, condition: () => boolean, duration: number = 2000): Promise<boolean> {
    let timeout: NodeJS.Timeout;
    let callback: () => void;
    let pending: ((value: boolean) => void)[] = [];
    const p1 = new Promise<boolean>((resolve) => {
      callback = () => {
        if (condition()) {
          resolve(true);
        }
      };
      emitter.on(event, callback);
      pending.push(resolve);
    });
    const p2 = new Promise<boolean>((resolve) => {
      timeout = setTimeout(resolve, duration, false);
      pending.push(resolve);
    });
    return Promise.race([p1, p2]).finally(() => {
      clearTimeout(timeout);
      emitter.off(event, callback);
      pending.forEach((p) => p(false));
    });
  }

  beforeEach(async () => {
    service = new Service();
  });

  afterEach(async () => {
    await service.abort();
  });

  it('should discover and connect succeed', async () => {
    const { network } = randomPick(await batchCreateNodes(5));
    expect(
      await check(
        network,
        'installed',
        () => {
          return network.peers.length >= 4;
        },
        9000
      )
    ).be.true; // TODO: fix
  });
});
