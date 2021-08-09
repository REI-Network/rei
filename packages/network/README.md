# @gxchain2/network

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/network)](https://www.npmjs.org/package/@gxchain2/network)
![License](https://img.shields.io/npm/l/@gxchain2/network)

Implement a decentralized p2p network between nodes, based on `libp2p` and `discv5`. Protocol logic is abstracted out through `Protocol` and `ProtocolHandler`

## INSTALL

```sh
npm install @gxchain2/network
```

## USAGE

```ts
/**
 * Implements `Protocol` interface to custom your protocol
 */
class MyProtocol implements Protocol {
  /**
   * Should return protocol name
   */
  get name() {
    return "MyProtocol";
  }

  /**
   * Should return protocol string
   */
  get protocolString() {
    return "/MyProtocol/1";
  }

  /**
   * Should be called when new peer connected
   * Should create and return a new `ProtocolHandler` instance for the target new peer
   */
  makeHandler(peer: Peer) {
    return new MyProtocolHandler(peer, this.name);
  }
}

/**
 * Implements `ProtocolHandler` interface to custom your protocol logic
 */
class MyProtocolHandler implements ProtocolHandler {
  private peer: Peer;
  private name: string;

  constructor(peer: Peer, name: string) {
    this.peer = peer;
    this.name = name;
  }

  private encode(method: number, data: any) {
    return Buffer.from([method as number, ...Buffer.from(data)]);
  }

  private send(method: number, data: any) {
    this.peer.send(this.name, this.encode(method, data));
  }

  /**
   * Should be called when new peer connected
   * Return `false` if handshake failed
   */
  handshake(): boolean | Promise<boolean> {
    this.send(0, "ping");
    return true;
  }

  /**
   * Should be called when receive message from remote peer
   */
  async handle(data: Buffer) {
    const [method, payload] = data;
    if (method === 0) {
      this.send(1, "pong");
      console.log("receive ping from:", this.peer.peerId);
    } else if (method === 1) {
      console.log("receive pong from:", this.peer.peerId);
    }
  }

  /**
   * Should be called when remote peer disconnted
   */
  abort() {
    console.log("abort");
  }
}
```

```ts
/**
 * Provide your protocol instance to `NetworkManager` in the constructor
 * and `NetworkManager` will take care of the rest
 */
const networkMngr = new NetworkManager({
  protocols: [new MyProtocol()],
  datastore: datastore,
  nodedb: nodedb,
  peerId: peerId,
  bootnodes: ["...", "..."],
});
await networkMngr.init();
await networkMngr.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
