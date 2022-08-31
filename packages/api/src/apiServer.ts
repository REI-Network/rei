import { Node } from '@rei-network/core';
import { RpcServer } from './types';
import { SimpleOracle } from './gasPriceOracle';
import { FilterSystem } from './filterSystem';
import { api } from './controller';

const apis = 'admin,debug,eth,net,rei,txpool,web3';

/**
 * Api server
 */
export class ApiServer {
  readonly node: Node;
  readonly oracle: SimpleOracle;
  readonly filterSystem: FilterSystem;
  readonly controllers = new Map<string, { [name: string]: any }>();
  rpcServer!: RpcServer;

  constructor(node: Node) {
    this.node = node;
    this.oracle = new SimpleOracle(node);
    this.filterSystem = new FilterSystem(node);
    apis.split(',').map((name) => {
      if (!(name in api)) {
        throw new Error(`Unknown api ${name}`);
      }
      this.controllers.set(name, new api[name](this));
    });
  }

  /**
   * Start oracle and filter system
   */
  start() {
    this.oracle.start();
    this.filterSystem.start();
  }

  /**
   * Abort oracle and filter system
   */
  abort() {
    this.filterSystem.abort();
    this.oracle.abort();
  }

  /**
   * Set the rpcServer
   * @param rpcServer - RpcServer object
   */
  setRpcServer(rpcServer: RpcServer) {
    this.rpcServer = rpcServer;
  }
}
