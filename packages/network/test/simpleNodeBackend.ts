import { NetworkManager } from '../src';

const express = require('express');
const app = express();

app.post('/nodeConnections', async function (req, res) {
  const nodes: { count: number; localId: string; localEnr: string; peers: string[]; connectionSize: number }[] = [];
  for (let i = 0; i < app.nodes.length; i++) {
    const node = app.nodes[i];
    const localEnr: string = node.localEnr.encodeTxt();
    const localId: string = (await node.localEnr.peerId()).toB58String();
    const peers = node.peers.map((peer) => peer.peerId);
    const connectionSize: number = peers.length;
    nodes.push({ count: i, localId, localEnr, peers, connectionSize });
  }
  res.send(nodes);
});

export function startServer(nodes: NetworkManager[], port: number) {
  app.nodes = nodes;
  app.listen(port);
}
