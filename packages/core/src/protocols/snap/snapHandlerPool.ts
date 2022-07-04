import { getRandomIntInclusive } from '@rei-network/utils';
import { PeerType } from '../../sync/snap';
import { SnapProtocolHandler } from './handler';

const types: PeerType[] = ['account', 'storage', 'code', 'trieNode'];

/**
 * SnapHandlerPool is used to manage all the SnapProtocolHandler
 */
export class SnapHandlerPool {
  private idlePools = new Map<PeerType, Set<SnapProtocolHandler>>();
  private busyPools = new Map<PeerType, Set<SnapProtocolHandler>>();

  constructor() {
    for (const type of types) {
      this.idlePools.set(type, new Set<SnapProtocolHandler>());
      this.busyPools.set(type, new Set<SnapProtocolHandler>());
    }
  }

  private addIdleHandler(handler: SnapProtocolHandler, peerType: PeerType) {
    const pool = this.idlePools.get(peerType)!;
    pool.add(handler);
  }

  /**
   * Add a handler to IdlePool and busyPool
   * @param handler - SnapProtocolHandler to add
   */
  add(handler: SnapProtocolHandler) {
    for (const type of types) {
      this.addIdleHandler(handler, type);
    }
  }

  /**
   *  Remove handler from IdlePool and busyPool
   * @param handler - SnapProtocolHandler to remove
   */
  remove(handler: SnapProtocolHandler) {
    for (const type of types) {
      this.idlePools.get(type)!.delete(handler);
      this.busyPools.get(type)!.delete(handler);
    }
  }

  /**
   * Get a handler from IdlePool
   * @param type - PeerType
   * @returns Returns a handler if there is one, otherwise return null
   */
  getIdlePeer(type: PeerType) {
    const idlePool = this.idlePools.get(type)!;
    if (idlePool.size > 0) {
      const handler = Array.from(idlePool)[getRandomIntInclusive(0, idlePool.size - 1)];
      idlePool.delete(handler);
      const busyPool = this.busyPools.get(type)!;
      busyPool.add(handler);
      return handler;
    }
    return null;
  }

  /**
   * Put back handler into IdlePool
   * @param type - PeerType
   * @param handler - SnapProtocolHandler to put back
   */
  putBackIdlePeer(type: PeerType, handler: SnapProtocolHandler) {
    if (this.busyPools.get(type)!.delete(handler)) {
      this.addIdleHandler(handler, type);
    }
  }
}
