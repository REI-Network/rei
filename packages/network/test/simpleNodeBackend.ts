import { NetworkManager } from '../src';

const express = require('express');
const app = express();
app.use(express.json());
app.post('/nodeConnections', async function (req, res) {
  const nodes: { count: number; peerId: string; nodeId: string; localEnr: string; peers: string[]; kbucktPeers: string[]; kSize: number; connectionSize: number }[] = [];
  for (let i = 0; i < app.nodes.length; i++) {
    try {
      const node = app.nodes[i];
      const localEnr: string = node.localEnr.encodeTxt();
      const peerId: string = (await node.localEnr.peerId()).toB58String();
      const nodeId: string = node.localEnr.nodeId;
      const peers = node.peers.map((peer) => peer.peerId);
      const connectionSize: number = peers.length;
      const kbucktPeers = await node.kbucketPeers();
      nodes.push({ count: i, peerId, nodeId, localEnr, peers, connectionSize, kbucktPeers, kSize: kbucktPeers.length });
    } catch (e) {
      console.log(e);
      res.send({ error: (e as any).message });
      break;
    }
  }
  res.send(nodes);
});

app.post('/addEnr', async function (req, res) {
  const enr = req.body.enr;
  const targetId = req.body.targetId;
  for (const node of app.nodes) {
    if ((await node.localEnr.peerId()).toB58String() === targetId) {
      node.addPeer(enr);
      res.send('success');
    }
  }
});

app.post('/addTrustedPeer', async function (req, res) {
  const peerId = req.body.peerId;
  const targetId = req.body.targetId;
  for (const node of app.nodes) {
    if ((await node.localEnr.peerId()).toB58String() === targetId) {
      node.addTrustedPeer(peerId);
      res.send('success');
    }
  }
});

app.post('/getConnectionSize', async function (req, res) {
  const targetId = req.body.targetId;
  for (const node of app.nodes) {
    if ((await node.localEnr.peerId()).toB58String() === targetId) {
      res.send({ result: node.getConnectionSize() });
    }
  }
});

app.post('/isTrusted', async function (req, res) {
  const peerId = req.body.peerId;
  const targetId = req.body.targetId;
  for (const node of app.nodes) {
    if ((await node.localEnr.peerId()).toB58String() === targetId) {
      res.send({ result: node.isTrusted(peerId) });
    }
  }
});

app.post('/removePeer', async function (req, res) {
  const targetId = req.body.targetId;
  const peerId = req.body.peerId;
  for (const node of app.nodes) {
    if ((await node.localEnr.peerId()).toB58String() === targetId) {
      await node.removePeer(peerId);
      res.send({ result: 'success' });
    }
  }
});

export function startServer(nodes: NetworkManager[], port: number) {
  app.nodes = nodes;
  app.listen(port);
}
