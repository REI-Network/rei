import EventEmitter from 'events';
import { expect, assert } from 'chai';
import { getRandomIntInclusive, setLevel } from '@rei-network/utils';
import { Service, Endpoint, MockProtocol } from './mock';
import { Protocol } from '../src';

setLevel('silent');

describe('NetworkManager', () => {
  let service: Service;
  let nodes: Endpoint[];

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

  describe('should be established and reconnected correctly', () => {
    const protocol = new MockProtocol(1);

    it('should create nodes succeed', async () => {
      service = new Service();
      nodes = await batchCreateNodes(5, [protocol]);
    });

    it('should discover and connect succeed', async () => {
      expect(
        await multiCheck(
          nodes.map(({ network }) => network),
          'installed',
          (network) => {
            return network.peers.length >= 4;
          }
        )
      ).be.true;
    });

    it('should get and update multi address succeed', () => {
      for (const { network, discv5, libp2p } of nodes) {
        expect(network.peers.length).be.equal(4);
        expect(network.connectionSize).be.equal(4);
        expect(discv5.localEnr.ip, 'enr address should be updated').be.equal(service.getRealIPByNodeId(discv5.localEnr.nodeId));
        const otherNodes = nodes.filter((node) => !node.libp2p.peerId.equals(libp2p.peerId));
        for (const otherNode of otherNodes) {
          const addrs = libp2p.getAddress(otherNode.libp2p.peerId);
          expect(addrs !== undefined && addrs.length === 1).be.true;
          const addr = addrs![0].nodeAddress();
          expect(addr.address, 'address book should be correct').be.equal(service.getRealIPByPeerId(otherNode.libp2p.peerId.toB58String()));
        }
      }
    });

    it('should request succeed', async () => {
      const { network } = randomPick(nodes);
      const peer = randomPick(network.peers);
      expect(await protocol.getHandler(peer).request()).be.true;
    });

    it('should update multi address when ip address changed', async () => {
      const endpoint = randomPick(nodes);
      const newIP = service.generateIP();
      service.setRealIP(endpoint.network.peerId, endpoint.discv5.localEnr.nodeId, newIP);
      expect(
        await check(endpoint.discv5, 'multiaddrUpdated', () => {
          return true;
        })
      ).be.true;
      expect(endpoint.discv5.localEnr.ip).be.equal(newIP);
    });

    it('should connect remote peer after outbound timeout', async () => {
      const endpoint = randomPick(nodes);
      const peer = randomPick(endpoint.network.peers);
      const conns = endpoint.libp2p.getConnections(peer.peerId);
      expect(conns !== undefined && conns.length > 0).be.true;
      const conn = randomPick(conns!);
      // manually disconnect
      await endpoint.libp2p.disconnect(peer.peerId, (conn as any).id);
      expect(
        await check(endpoint.libp2p, 'connect', () => {
          return endpoint.libp2p.connectionSize >= 4;
        })
      ).be.true;
    });

    it('should abort succeed', async () => {
      await service.abort();
      nodes = [];
    });
  });

  describe('should handle the protocol correctly', () => {
    const protocol1 = new MockProtocol(1);
    const protocol2 = new MockProtocol(2);
    const protocol3 = new MockProtocol(3);
    const protocol4 = new MockProtocol(4);

    it('should create nodes succeed', async () => {
      service = new Service();
      nodes = await batchCreateNodes(3, [protocol1, [protocol2, protocol3], protocol4]);
    });

    it('should discover and connect succeed', async () => {
      expect(
        await multiCheck(
          nodes.map(({ network }) => network),
          'installed',
          (network) => {
            return network.peers.length >= 2;
          }
        )
      ).be.true;
    });

    it('should handshake succeed', async () => {
      const endpoint = randomPick(nodes);
      expect(endpoint.network.peers.length).gt(0);
      for (const peer of endpoint.network.peers) {
        expect(!!peer.getHandler(protocol1.protocolString)).be.true;
        expect(!!peer.getHandler(protocol2.protocolString)).be.true;
        expect(!!peer.getHandler(protocol4.protocolString)).be.true;
        try {
          peer.getHandler(protocol3.protocolString);
          assert.fail("protocol3 shouldn't exist");
        } catch (err) {
          // ignore error...
        }
      }
    });

    it('should abort succeed', async () => {
      await service.abort();
      nodes = [];
    });
  });
});
