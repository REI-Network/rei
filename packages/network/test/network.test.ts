import EventEmitter from 'events';
import { expect } from 'chai';
import { getRandomIntInclusive, setLevel } from '@rei-network/utils';
import { Service, Endpoint, MockProtocol } from './mock';
import { Protocol } from '../src';

// TODO: silent
setLevel('detail');

describe('NetworkManager', () => {
  let service: Service;

  /**
   * Batch create nodes,
   * this function will create a bootnode
   * and let other node connect with the bootnode
   * @param count - Number of nodes
   * @param protocols - Protocol list
   * @returns Nodes
   */
  async function batchCreateNodes(count: number, protocols: (Protocol | Protocol[])[] = [new MockProtocol(1)]) {
    if (count <= 1) {
      throw new Error('invalid count');
    }
    const bootnode = await service.createEndpoint(protocols);
    const bootnodeENR = bootnode.discv5.localEnr.encodeTxt();
    const nodes: Endpoint[] = [bootnode];
    for (let i = 0; i < count - 1; i++) {
      nodes.push(await service.createEndpoint(protocols, [bootnodeENR], true));
    }
    return nodes;
  }

  /**
   * Radom pick an element
   * @param array
   * @returns
   */
  function randomPick<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('empty array');
    }
    return array[getRandomIntInclusive(0, array.length - 1)];
  }

  /**
   * Check for a condition,
   * if it times out, consider it a failure
   * @param emitter - Event emitter
   * @param event - Event name
   * @param condition - Condition function
   * @param duration - Timeout duration
   * @returns Whether succeed
   */
  function check<T extends EventEmitter>(emitter: T, event: string, condition: (emitter: T) => boolean, duration: number = 5000): Promise<boolean> {
    let timeout: NodeJS.Timeout;
    let callback: () => void;
    let pending: ((value: boolean) => void)[] = [];
    const p1 = new Promise<boolean>((resolve) => {
      callback = () => {
        if (condition(emitter)) {
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

  /**
   * Check for conditions,
   * if it times out, consider it a failure
   * @param emitters - Event emitter list
   * @param event - Event name
   * @param condition - Condition function
   * @param duration - Timeout duration
   * @returns Whether succeed
   */
  function multiCheck<T extends EventEmitter>(emitters: T[], event: string, condition: (emitter: T) => boolean, duration: number = 5000) {
    let timeout: NodeJS.Timeout;
    let callbacks: (() => void)[] = [];
    let results = new Array<boolean>(emitters.length).fill(false);
    let pending: ((value: boolean) => void)[] = [];
    const p1 = new Promise<boolean>((resolve) => {
      emitters.forEach((emitter, i) => {
        const callback = () => {
          if (!results[i] && condition(emitter)) {
            results[i] = true;
            if (results.every((v) => v)) {
              resolve(true);
            }
          }
        };
        callbacks.push(callback);
        emitter.on(event, callback);
      });
      pending.push(resolve);
    });
    const p2 = new Promise<boolean>((resolve) => {
      timeout = setTimeout(resolve, duration, false);
      pending.push(resolve);
    });
    return Promise.race([p1, p2]).finally(() => {
      clearTimeout(timeout);
      emitters.forEach((emitter, i) => emitter.off(event, callbacks[i]));
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
    const nodes = await batchCreateNodes(5);
    expect(
      await multiCheck(
        nodes.map(({ network }) => network),
        'installed',
        (network) => {
          return network.peers.length >= 4;
        }
      )
    ).be.true;
    for (const { network } of nodes) {
      expect(network.peers.length).be.equal(4);
      expect(network.connectionSize).be.equal(4);
    }
  });
});
