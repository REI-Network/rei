import { Peer, ProtocolStream } from '@rei-network/network';
import { Receipt, ReceiptRawValue } from '@rei-network/structure';
import { WireProtocolHandler, WireProtocol } from '../handler';
import { HandlerFunc, wireHandlerBaseFuncs } from '../wireFunctions';
import * as c from '../config';

const wireHandlerFuncsV2: HandlerFunc[] = [
  ...wireHandlerBaseFuncs,
  {
    name: 'GetReceipts',
    code: 9,
    response: 10,
    encode(this: WireProtocolHandlerV2, hashes: Buffer[]) {
      return [...hashes];
    },
    decode(this: WireProtocolHandlerV2, hashes): Buffer[] {
      return hashes;
    },
    async process(this: WireProtocolHandlerV2, hashes: Buffer[]) {
      if (hashes.length > c.maxGetReceipts) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      const db = this.node.db;
      const results: Receipt[][] = [];
      for (const hash of hashes) {
        const receipts = await db.getReceipts(await db.hashToNumber(hash), hash);
        results.push(receipts);
      }
      return ['Receipts', results];
    }
  },
  {
    name: 'Receipts',
    code: 10,
    encode(this: WireProtocolHandlerV2, receipts: Receipt[][]): ReceiptRawValue[][] {
      return receipts.map((rs) => rs.map((r) => r.raw()));
    },
    decode(this: WireProtocolHandlerV2, raw: ReceiptRawValue[][]): Receipt[][] {
      return raw.map((rs) => rs.map((r) => Receipt.fromValuesArray(r)));
    }
  }
];

export class WireProtocolHandlerV2 extends WireProtocolHandler {
  constructor(protocol: WireProtocol, peer: Peer, stream: ProtocolStream) {
    super(protocol, peer, stream, wireHandlerFuncsV2);
  }

  /**
   * Get receipts from remote peer
   * @param hashes - Block hashes
   * @returns Receipts
   */
  getReceipts(hashes: Buffer[]): Promise<Receipt[][]> {
    return this.request('GetReceipts', hashes);
  }
}
