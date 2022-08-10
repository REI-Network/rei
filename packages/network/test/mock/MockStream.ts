import { Channel } from '@rei-network/utils';
import { Stream } from '../../src/types';
import { Data, MockConnection } from './MockConnection';
export class MockStream implements Stream {
  //协议名称
  public protocol: string;
  //local connection
  private connection: MockConnection;
  //远端数据接收迭代器(元素好是由connection获取远端数据后分流输入)
  private receiveChannel: Channel<{ _bufs: Buffer[] }>;
  //发送数据通道
  private sendChannel: Channel<Data>;
  //状态属性
  private isAbort: boolean = false;

  constructor(protocol: string, receiveChannel: Channel<{ _bufs: Buffer[] }>, sendChannel: Channel<Data>, connection: MockConnection) {
    this.protocol = protocol;
    this.connection = connection;
    this.receiveChannel = receiveChannel;
    this.sendChannel = sendChannel;
  }

  //遍历迭代器的输入数据并发送至远端节点(调用connection的sendDate将数据发送至远端节点)
  sink = async (source: AsyncGenerator<Buffer, any, unknown>) => {
    while (true && !this.isAbort) {
      const { value } = await source.next();
      if (value !== undefined) {
        this.sendChannel.push({ protocol: this.protocol, data: { _bufs: [value] } });
      } else {
        continue;
      }
    }
  };

  //接收远端数据迭代器
  source = () => {
    return this.receiveChannel[Symbol.asyncIterator]();
  };

  //关闭stream(通知connection关闭stream)
  close(): void {
    this.connection.handleStreamClose(this);
  }

  //关闭stream的实际操作(1.将状态变量设置为true 2.删除迭代器对象 3.调用connection的handleStreamClose来通知connection删除stream)
  doClose(): void {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.receiveChannel.abort();
  }

  //处理远端数据
  handleData(data: { _bufs: Buffer[] }) {
    this.receiveChannel.push(data);
  }
}
