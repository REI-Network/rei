import { EventEmitter } from 'events';

import type { Peer } from './peer';
import type { Libp2pNode } from './p2p';
import type { Protocol } from './protocol';

export declare interface PeerPool {
  on(event: 'error', listener: (err: any) => void): this;
  on(event: 'added' | 'removed' | 'banned' | 'idle' | 'busy', listener: (peer: Peer) => void): this;
  on(event: 'message', listener: (message: any, protocol: Protocol, peer: Peer) => void): this;

  once(event: 'error', listener: (err: any) => void): this;
  once(event: 'added' | 'removed' | 'banned' | 'idle' | 'busy', listener: (peer: Peer) => void): this;
  once(event: 'message', listener: (message: any, protocol: Protocol, peer: Peer) => void): this;
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
      node.on('error', (err) => {
        console.error('Peerpool, p2p node error:', err);
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

  idle(name: string) {
    try {
      const peers = this.peers.filter((p) => p.idle && p.latestHeight(name));
      const index = Math.floor(Math.random() * peers.length);
      return peers[index];
    } catch (err) {
      this.emit('error', err);
    }
  }

  connected(peer: Peer) {
    if (this.size >= this.maxSize) return;
    peer.on('message', (_, message: any, protocol: Protocol) => {
      if (this.pool.get(peer.peerId)) {
        this.emit('message', message, protocol, peer);
      }
    });
    peer.on('idle', (peer) => {
      if (this.pool.get(peer.peerId)) {
        this.emit('idle', peer);
      }
    });
    peer.on('busy', (peer) => {
      if (this.pool.get(peer.peerId)) {
        this.emit('busy', peer);
      }
    });
    peer.on('error', (peer, err) => {
      if (this.pool.get(peer.peerId)) {
        console.warn(`Peerpool, peer error: ${err} ${peer.peerId}`);
        this.ban(peer);
      } else {
        console.error('Peerpool, peer error:', err);
      }
    });
    this.add(peer);
  }

  disconnected(peer: Peer) {
    this.remove(peer);
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
}
