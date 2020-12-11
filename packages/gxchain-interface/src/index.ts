export interface INode {
  init(): Promise<void>;
  status: any;
}
