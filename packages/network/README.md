# @gxchain2/network

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/network)](https://www.npmjs.org/package/@gxchain2/network)
![License](https://img.shields.io/npm/l/@gxchain2/network)

Implement a decentralized p2p network between nodes, based on `libp2p`

## INSTALL

```sh
npm install @gxchain2/network
```

## USAGE

```ts
class MyProtocol implements Protocol {
  get name() {
    return 'MyProtocol';
  }
  get protocolString() {
    return '/MyProtocol/1';
  }
  makeHandler(peer: Peer) {
    return new MyProtocolHandler(peer, this.name);
  }
}

class MyProtocolHandler implements ProtocolHandler {
  private peer: Peer;
  private name: string;
  private queue?: MsgQueue;

  constructor(peer: Peer, name: string) {
    this.peer = peer;
    this.name = name;
  }

  private getMsgQueue() {
    return this.queue ? this.queue : (this.queue = this.peer.getMsgQueue(this.name));
  }

  handshake(): boolean | Promise<boolean> {
    this.getMsgQueue().send(0, 'ping');
    return true;
  }

  async handle(data: Buffer) {
    const [method, payload] = data;
    if (method === 0) {
      this.getMsgQueue().send(1, 'pong');
      console.log('receive ping from:', this.peer.peerId);
    } else if (method === 1) {
      console.log('receive pong from:', this.peer.peerId);
    }
  }

  encode(method: string | number, data: any) {
    return Buffer.from([method as number, ...Buffer.from(data)]);
  }

  abort() {}
}

const networkMngr = new NetworkManager({
  protocols: [new MyProtocol()],
  datastore: datastore,
  nodedb: nodedb,
  peerId: peerId,
  bootnodes: ['...', '...']
});
await networkMngr.init();
await networkMngr.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
