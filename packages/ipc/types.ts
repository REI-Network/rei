export interface RpcServer {
  isRunning: boolean;
  start(): Promise<void>;
  abort(): Promise<void>;
}
