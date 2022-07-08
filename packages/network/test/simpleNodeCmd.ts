import { program } from 'commander';
import { autoStartNodes } from './simpleNode';
import { startServer } from './simpleNodeBackend';

async function main() {
  await install(program);
}

async function install(program) {
  program
    .option('-i, --ip <ip>', 'ip address') //ip address

    .option('-u, --udpPort <udpPort>', 'udp port', parseInt) //udp port

    .option('-t, --tcpPort <tcpPort>', 'tcp port', parseInt) //tcp ports

    .option('-s, --server <port>', 'start a server on this port') //start a server on this port

    .option('-c,--count <count>', 'number of nodes to start', parseInt) //number of nodes to start

    .option('-e, --enr <bootEnr>', 'boot enr') //boot enr

    .parse(process.argv);

  if (program.server) {
    const ip = program.ip;
    const serverPort = program.server;
    const tcp = program.tcpPort;
    const udp = program.udpPort;
    const enr = program.enr;
    let count = program.count;
    if (ip && serverPort && tcp && udp) {
      const nodes = await autoStartNodes({ ip, udpPort: udp, tcpPort: tcp, count, bootEnr: enr });
      startServer(nodes, serverPort);
    }
  }
}

main();
