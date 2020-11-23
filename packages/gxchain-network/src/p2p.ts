import Libp2p from 'libp2p';
import WebSockets from 'libp2p-websockets';
import { NOISE } from 'libp2p-noise';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import GossipSub from 'libp2p-gossipsub';
import TCP from 'libp2p-tcp';
// import MulticastDNS from 'libp2p-mdns';
// import Bootstrap from 'libp2p-bootstrap';

import { constants } from '@gxchain2/common';
import { Node, Peer, P2P } from '@gxchain2/interface';

import PeerImpl from './peer';
import { handleJSONRPC, handleGossip } from './rpc';

export default class P2PImpl implements P2P {
  libp2pNode: any;
  private peerId: PeerId | undefined;
  private peerInfoMap = new Map<string, Peer>();
  private handleJSONRPC: (peer: Peer, method: string, params?: any) => Promise<any> | any;
  private handleGossip: (topic: string, msg: { data: Uint8Array }) => Promise<void>;

  constructor(node: Node, peerId?: PeerId) {
    this.handleJSONRPC = handleJSONRPC.bind(undefined, node);
    this.handleGossip = handleGossip.bind(undefined, node);
    this.peerId = peerId;
  }

  getPeer(id: string) {
    return this.peerInfoMap.get(id);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peerInfoMap.forEach(fn);
  }

  getLocalPeerId() {
    return this.peerId!.toB58String();
  }

  async init() {
    this.peerId = this.peerId || (await PeerId.create({ bits: 1024, keyType: 'Ed25519' }));

    this.libp2pNode = await Libp2p.create({
      peerId: this.peerId,
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws']
      },
      modules: {
        transport: [TCP, WebSockets],
        connEncryption: [NOISE],
        streamMuxer: [MPLEX],
        dht: KadDHT,
        pubsub: GossipSub
        // peerDiscovery: [MulticastDNS]
        // peerDiscovery: [Bootstrap]
      },
      config: {
        dht: {
          kBucketSize: 20,
          enabled: true,
          randomWalk: {
            enabled: true,
            interval: 3e3,
            timeout: 10e3
          }
        },
        peerDiscovery: {
          autoDial: true
          // [MulticastDNS.tag]: {
          //     interval: 1e3,
          //     enabled: true
          // }
          // bootstrap: {
          //     interval: 60e3,
          //     enabled: true,
          //     list: ['...']
          // }
        },
        pubsub: {
          enabled: true,
          emitSelf: false,
          signMessages: true,
          strictSigning: true
        }
      },
      connectionManager: {
        autoDialInterval: 3e3,
        minConnections: 3,
        maxConnections: 20
      }
    });

    this.libp2pNode.on('peer:discovery', (peer) => {
      console.log('\n$ Discovered', peer._idB58String); // Log discovered peer
    });

    this.libp2pNode.on('error', (err) => {
      console.error('\n$ Error', err.message);
    });

    this.libp2pNode.connectionManager.on('peer:connect', (connection) => {
      const id = connection.remotePeer._idB58String;
      connection
        .newStream(constants.JSONRPCProtocol)
        .then(({ stream }) => {
          let peer = this.peerInfoMap.get(id);
          if (!peer || peer.isWriting()) {
            if (peer) {
              peer.abort();
              this.peerInfoMap.delete(id);
            }
            peer = new PeerImpl(id, this.handleJSONRPC);
            this.peerInfoMap.set(id, peer);
          }
          console.log('\n$ Connected to', id);
          peer.pipeWriteStream(stream);
        })
        .catch((err) => {
          console.error('\n$ Error, newStream', err.message);
        });
    });

    this.libp2pNode.connectionManager.on('peer:disconnect', (connection) => {
      const id = connection.remotePeer._idB58String;
      console.log('\n$ Disconnected to', id);

      const peer = this.peerInfoMap.get(id);
      if (peer) {
        peer.abort();
        this.peerInfoMap.delete(id);
      }
      this.libp2pNode.hangUp(connection.remotePeer).catch((err) => console.error('\n$ Error, hangUp', err));
    });

    // Handle messages for the protocol
    await this.libp2pNode.handle(constants.JSONRPCProtocol, ({ connection, stream, protocol }) => {
      const id = connection.remotePeer._idB58String;
      let peer = this.peerInfoMap.get(id);
      if (!peer || peer.isReading()) {
        if (peer) {
          peer.abort();
          this.peerInfoMap.delete(id);
        }
        peer = new PeerImpl(id, this.handleJSONRPC);
        this.peerInfoMap.set(id, peer);
      }
      console.log('\n$ Receive', protocol, 'from', id);
      peer.pipeReadStream(stream);
    });

    // start libp2p
    await this.libp2pNode.start();
    console.log('Libp2p has started', this.peerId.toB58String());
    this.libp2pNode.multiaddrs.forEach((ma) => {
      console.log(ma.toString() + '/p2p/' + this.peerId!.toB58String());
    });

    for (const topic of constants.GossipTopics) {
      this.libp2pNode.pubsub.on(topic, this.handleGossip.bind(undefined, topic));
      await this.libp2pNode.pubsub.subscribe(topic);
    }
  }
}
