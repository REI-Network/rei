import { EventEmitter } from 'events';
import PeerId from 'peer-id';
import type { Peer } from './peer';
import type { Libp2pNode } from './p2p';
import { logger } from '@gxchain2/utils';

export declare interface PeerPool {
  on(event: 'error', listener: (err: any) => void): this;
  on(event: 'idle' | 'busy', listener: (peer: Peer, type: string) => void): this;
  on(event: 'added' | 'removed' | 'banned', listener: (peer: Peer) => void): this;

  once(event: 'error', listener: (err: any) => void): this;
  once(event: 'idle' | 'busy', listener: (peer: Peer, type: string) => void): this;
  once(event: 'added' | 'removed' | 'banned', listener: (peer: Peer) => void): this;
}

export class PeerPool extends EventEmitter {
  private pool = new Map<string, Peer>();
  private readonly _nodes: Libp2pNode[];
  public readonly maxSize: number;

  constructor(options: { nodes: Libp2pNode[]; maxSize?: number }) {
    super();
    options.nodes.forEach((node) => {
      node.on('connected', (peer) => {
        this.connected(peer);
      });
      node.on('disconnected', (peer) => {
        this.disconnected(peer);
      });
      node.on('error', (err) => {
        logger.error('Peerpool, p2p node error:', err);
      });
    });
    this.maxSize = options.maxSize || 32;
    this._nodes = options.nodes;
  }

  get peers() {
    return Array.from(this.pool.values());
  }

  get size() {
    return this.peers.length;
  }

  get nodes() {
    return [...this._nodes];
  }

  idle(filter: (p: Peer) => boolean) {
    try {
      const peers = this.peers.filter(filter);
      const index = Math.floor(Math.random() * peers.length);
      return peers[index];
    } catch (err) {
      this.emit('error', err);
    }
  }

  connected(peer: Peer) {
    if (this.size >= this.maxSize) {
      return;
    }
    peer.on('idle', (type) => {
      if (this.pool.get(peer.peerId)) {
        this.emit('idle', peer, type);
      }
    });
    peer.on('busy', (type) => {
      if (this.pool.get(peer.peerId)) {
        this.emit('busy', peer, type);
      }
    });
    peer.on('error', (err) => {
      if (this.pool.get(peer.peerId)) {
        logger.warn('Peerpool, peer error:', err);
        this.ban(peer);
      } else {
        logger.error('Peerpool, peer error:', err);
      }
    });
    this.add(peer);
  }

  disconnected(peer: Peer) {
    this.remove(peer);
    for (const n of this._nodes) {
      n.peerStore.delete(PeerId.createFromB58String(peer.peerId));
    }
  }

  ban(peer: Peer, maxAge: number = 60000) {
    peer.node.ban(peer.peerId, maxAge);
    this.remove(peer);
    this.emit('banned', peer);
  }

  add(peer: Peer) {
    if (!this.pool.has(peer.peerId)) {
      this.pool.set(peer.peerId, peer);
      this.emit('added', peer);
    }
  }

  remove(peer: Peer) {
    if (this.pool.delete(peer.peerId)) {
      this.emit('removed', peer);
    }
  }

  getPeer(peerId: string) {
    return this.pool.get(peerId);
  }
}
