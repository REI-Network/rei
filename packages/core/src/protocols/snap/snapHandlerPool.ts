import { getRandomIntInclusive } from '@rei-network/utils';
import { PeerType } from '../../sync/snap';
import { SnapProtocolHandler } from './handler';

const types: PeerType[] = ['account', 'storage', 'code', 'trieNode'];

/**
 * SnapHandlerPool is used to manage all the SnapProtocolHandler
 */
export class SnapHandlerPool {
  private statelessPool = new Map<string, SnapProtocolHandler>();
  private idlePools = new Map<PeerType, Map<string, SnapProtocolHandler>>();
  private busyPools = new Map<PeerType, Map<string, SnapProtocolHandler>>();

  constructor() {
    for (const type of types) {
      this.idlePools.set(type, new Map<string, SnapProtocolHandler>());
      this.busyPools.set(type, new Map<string, SnapProtocolHandler>());
    }
  }

  /**
   * Add a handler to IdlePool and busyPool
   * @param handler - SnapProtocolHandler to add
   */
  add(handler: SnapProtocolHandler) {
    for (const type of types) {
      this.idlePools.get(type)!.set(handler.id, handler);
    }
  }

  /**
   * Remove handler from IdlePool and busyPool
   * @param handler - SnapProtocolHandler to remove
   */
  remove(handler: SnapProtocolHandler) {
    this.statelessPool.delete(handler.id);
    for (const type of types) {
      this.idlePools.get(type)!.delete(handler.id);
      this.busyPools.get(type)!.delete(handler.id);
    }
  }

  /**
   * Get a handler from IdlePool
   * @param type - PeerType
   * @returns Returns a handler if exists, otherwise return null
   */
  getIdlePeer(type: PeerType) {
    const idlePool = this.idlePools.get(type)!;
    if (idlePool.size > 0) {
      const handler = Array.from(idlePool.values())[getRandomIntInclusive(0, idlePool.size - 1)];
      idlePool.delete(handler.id);
      this.busyPools.get(type)!.set(handler.id, handler);
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
    if (this.busyPools.get(type)!.delete(handler.id)) {
      this.idlePools.get(type)!.set(handler.id, handler);
    }
  }

  /**
   * mark a node as stateless
   * @param handler - Stateless peer
   */
  putStatelessPeer(handler: SnapProtocolHandler) {
    let removed = false;
    for (const type of types) {
      removed = this.idlePools.get(type)!.delete(handler.id) || removed;
      removed = this.busyPools.get(type)!.delete(handler.id) || removed;
    }
    if (removed) {
      this.statelessPool.set(handler.id, handler);
    }
  }

  /**
   * Reset all stateless peers, putting them back into the idle pool
   */
  resetStatelessPeer() {
    for (const [, handler] of this.statelessPool) {
      this.add(handler);
    }
    this.statelessPool.clear();
  }
}
