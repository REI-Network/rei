import { getRandomIntInclusive } from '@rei-network/utils';
import { PeerType } from '../../sync/snap';
import { SnapProtocolHandler } from './handler';

const types: PeerType[] = ['account', 'storage', 'code', 'trieNode'];

export class GetHandlerTimeoutError extends Error {}

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

  handlers(peerType: PeerType) {
    return [...Array.from(this.idlePools.get(peerType)!), ...Array.from(this.busyPools.get(peerType)!)];
  }

  add(handler: SnapProtocolHandler) {
    for (const type of types) {
      this.addIdleHandler(handler, type);
    }
  }

  remove(handler: SnapProtocolHandler) {
    let removed = false;
    for (const type of types) {
      removed = this.idlePools.get(type)!.delete(handler) || removed;
      removed = this.busyPools.get(type)!.delete(handler) || removed;
    }
    return removed;
  }

  get(peerType: PeerType) {
    const idlePool = this.idlePools.get(peerType)!;
    if (idlePool.size > 0) {
      const handler = Array.from(idlePool)[getRandomIntInclusive(0, idlePool.size - 1)];
      idlePool.delete(handler);
      const busyPool = this.busyPools.get(peerType)!;
      busyPool.add(handler);
      return handler;
    }
    return null;
  }

  put(handler: SnapProtocolHandler, peerType: PeerType) {
    if (this.busyPools.get(peerType)!.delete(handler)) {
      this.addIdleHandler(handler, peerType);
    }
  }
}
