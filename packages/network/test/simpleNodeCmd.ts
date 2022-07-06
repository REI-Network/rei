import { program } from 'commander';
import { bootNode, autoStartNodes, startNode } from './simpleNode';
import { startServer } from './simpleNodeBackend';

async function main() {
  await install(program);
}

async function install(program) {
  program
    .option('-a, --auto <amount>', 'auto start nodes', parseInt) //auto start nodes

    .option('-s, --server <port>', 'start a server on this port') //start a server on this port

    .option('-b, --boot', 'start boot node') //start boot node

    .option('-n, --node', 'start node') //start node

    .option('-i, --ip <ip>', 'ip address') //ip address

    .option('-u, --udpPort <udpPort>', 'udp port') //udp port

    .option('-t, --tcpPort <tcpPort>', 'tcp port') //tcp port

    .option('-e, --enr <bootEnr>', 'boot enr') //boot enr

    .parse(process.argv);

  if (program.boot) {
    const ip = program.ip;
    if (ip) {
      bootNode(ip);
    }
  }

  if (program.auto) {
    const ip = program.ip;
    const amount = program.auto;
    if (ip && amount) {
      autoStartNodes(amount, ip);
    }
  }

  if (program.node) {
    const ip = program.ip;
    const tcpPort = program.udpPort;
    const udpPort = program.tcpPort;
    const bootEnr = program.enr;
    if (tcpPort && udpPort && ip && bootEnr) {
      startNode(ip, tcpPort, udpPort, bootEnr);
    }
  }

  if (program.server) {
    const ip = program.ip;
    const port = program.server;
    if (ip && port) {
      const nodes = await autoStartNodes(3, ip);
      startServer(nodes, port);
    }
  }
}

main();
