import { NetworkManager } from '../src';

const express = require('express');
const app = express();
app.get('/nodeConnections', function (req, res) {
  res.send(app.nodes.length + '');
});

export function startServer(nodes: NetworkManager[], port: number) {
  app.nodes = nodes;
  app.listen(port);
}
