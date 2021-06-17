# @gxchain2/network
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/network)](https://www.npmjs.org/package/@gxchain2/network)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/network)](https://packagephobia.now.sh/result?p=@gxchain2/network)
![License](https://img.shields.io/npm/l/@gxchain2/network)

The communication network between nodes, based on `libp2p`

## INSTALL

```sh
npm install @gxchain2/network
```

## USAGE

```ts
new Libp2pNode({
  node: node,
  peerId,
  protocols: new Set<string>([constants.GXC2_ETHWIRE]),
  tcpPort: options.p2p.tcpPort,
  wsPort: options.p2p.wsPort,
  bootnodes: options.p2p.bootnodes
})
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
