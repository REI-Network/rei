import { NetworkManager } from '../src';

let nodes: NetworkManager[] = [];

const express = require('express');
const app = express();
app.use(express.json());
app.post('/nodeConnections', async function (req, res) {
  const response: { count: number; peerId: string; nodeId: string; localEnr: string; peers: string[]; connectionSize: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    try {
      const node = nodes[i];
      const localEnr: string = node.localEnr.encodeTxt();
      const peerId: string = node.peerId;
      const nodeId: string = node.localEnr.nodeId;
      const peers = node.peers.map((peer) => peer.peerId);
      const connectionSize: number = peers.length;
      response.push({ count: i, peerId, nodeId, localEnr, peers, connectionSize });
    } catch (e) {
      console.log(e);
      res.send({ error: (e as any).message });
      break;
    }
  }
  res.send(response);
});

app.post('/addEnr', async function (req, res) {
  const enr = req.body.enr;
  const targetId = req.body.targetId;
  for (const node of nodes) {
    if (node.peerId === targetId) {
      await node.addPeer(enr);
      res.send('success');
    }
  }
});

app.post('/addTrustedPeer', async function (req, res) {
  const peerId = req.body.peerId;
  const targetId = req.body.targetId;
  for (const node of nodes) {
    if (node.peerId === targetId) {
      await node.addTrustedPeer(peerId);
      res.send('success');
    }
  }
});

app.post('/getConnectionSize', function (req, res) {
  const targetId = req.body.targetId;
  for (const node of nodes) {
    if (node.peerId === targetId) {
      res.send({ result: node.connectionSize });
    }
  }
});

app.post('/isTrusted', async function (req, res) {
  const peerId = req.body.peerId;
  const targetId = req.body.targetId;
  for (const node of nodes) {
    if (node.peerId === targetId) {
      res.send({ result: await node.isTrusted(peerId) });
    }
  }
});

app.post('/removePeer', async function (req, res) {
  const targetId = req.body.targetId;
  const peerId = req.body.peerId;
  for (const node of nodes) {
    if (node.peerId === targetId) {
      await node.removePeer(peerId);
      res.send({ result: 'success' });
    }
  }
});

export function startServer(_nodes: NetworkManager[], port: number) {
  nodes = _nodes;
  app.listen(port);
}
