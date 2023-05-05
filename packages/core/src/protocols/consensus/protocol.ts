import { Protocol, Peer, ProtocolStream } from '@rei-network/network';
import { Node } from '../../node';
import { Message, Vote } from '../../reimint';
import { NetworkProtocol } from '../enum';
import { BaseProtocol } from '../baseProtocol';
import { ConsensusProtocolHandler } from './handler';

export interface SendMessageOptions {
  // broadcast the message but exlcude the target peers
  exclude?: string[];
  // send message to target peer
  to?: string;
  // boardcast the message to all peers
  broadcast?: boolean;
}

export class ConsensusProtocol extends BaseProtocol<ConsensusProtocolHandler> implements Protocol {
  private _handlers = new Set<ConsensusProtocolHandler>();

  constructor(node: Node) {
    super(node, NetworkProtocol.REI_CONSENSUS, '1');
  }

  get handlers() {
    return Array.from(this._handlers);
  }

  /**
   * Add handler instance to the set
   * @param handler - Handler
   */
  addHandler(handler: ConsensusProtocolHandler) {
    this._handlers.add(handler);
  }

  /**
   * Remove handler instance from the set
   * @param handler - Handler
   */
  removeHandler(handler: ConsensusProtocolHandler) {
    this._handlers.delete(handler);
  }

  /**
   * {@link Protocol.makeHandler}
   */
  async makeHandler(peer: Peer, stream: ProtocolStream) {
    return new ConsensusProtocolHandler(this, peer, stream);
  }

  /**
   * Broadcast vote to all remote peer
   * @param vote - Vote
   */
  broadcastVote(vote: Vote) {
    for (const handler of this.handlers) {
      try {
        handler.sendVote(vote);
      } catch (err) {
        // ignore all errors ...
      }
    }
  }

  /**
   * Broadcast p2p message to the remote peer
   * @param msg - Message
   * @param options - Send options {@link SendMessageOptions}
   */
  broadcastMessage(msg: Message, options: SendMessageOptions) {
    if (options.broadcast) {
      for (const handler of this.handlers) {
        try {
          handler.send(msg);
        } catch (err) {
          // ignore all errors ...
        }
      }
    } else if (options.to) {
      const peer = this.node.networkMngr.getPeer(options.to);
      if (peer) {
        this.getHandler(peer, false)?.send(msg);
      }
    } else if (options.exclude) {
      for (const handler of this.handlers) {
        if (!options.exclude.includes(handler.peer.peerId)) {
          try {
            handler.send(msg);
          } catch (err) {
            // ignore all errors ...
          }
        }
      }
    } else {
      throw new Error('invalid broadcast message options');
    }
  }
}
