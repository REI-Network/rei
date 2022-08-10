import { Channel } from '@rei-network/utils';
import { Stream } from '../../src/types';
import { Data, MockConnection } from './MockConnection';
export class MockStream implements Stream {
  //协议名称
  public protocol: string;
  //local connection
  private connection: MockConnection;
  //数据接收通道
  private receiveChannel: Channel<{ _bufs: Buffer[] }>;
  //发送数据通道
  private sendChannel: Channel<Data>;
  //状态属性
  private isAbort: boolean = false;
  //初始化各个通道
  constructor(protocol: string, receiveChannel: Channel<{ _bufs: Buffer[] }>, sendChannel: Channel<Data>, connection: MockConnection) {
    this.protocol = protocol;
    this.connection = connection;
    this.receiveChannel = receiveChannel;
    this.sendChannel = sendChannel;
  }

  //遍历迭代器的输入数据并将数据push到发送通道
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

  //返回远端数据迭代器
  source = () => {
    return this.receiveChannel[Symbol.asyncIterator]();
  };

  //关闭stream(通知connection关闭双方stream)
  close(): void {
    this.connection.handleStreamClose(this);
  }

  //关闭stream操作(1.将状态变量设置为true 2.停止接收数据通道)
  doClose(): void {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.receiveChannel.abort();
  }

  //接收远端数据
  handleData(data: { _bufs: Buffer[] }) {
    this.receiveChannel.push(data);
  }
}
