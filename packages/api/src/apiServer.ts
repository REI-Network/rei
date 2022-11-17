import { Node } from '@rei-network/core';
import { RpcServer } from './types';
import { SimpleOracle } from './gasPriceOracle';
import { FilterSystem } from './filterSystem';
import { api } from './controller';

/**
 * Api server
 */
export class ApiServer {
  readonly node: Node;
  readonly version: string;
  readonly oracle: SimpleOracle;
  readonly filterSystem: FilterSystem;
  readonly controllers = new Map<string, any>();
  rpcServer!: RpcServer;

  constructor(node: Node, version: string) {
    this.node = node;
    this.version = version;
    this.oracle = new SimpleOracle(node);
    this.filterSystem = new FilterSystem(node);
    for (const [name, controller] of Object.entries(api)) {
      this.controllers.set(name, new controller(this));
    }
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
    this.oracle.abort();
    this.filterSystem.abort();
  }

  /**
   * Set the rpcServer
   * @param rpcServer - RpcServer object
   */
  setRpcServer(rpcServer: RpcServer) {
    this.rpcServer = rpcServer;
  }
}
