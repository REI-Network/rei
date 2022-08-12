import { Channel } from '@rei-network/utils';
import { Stream } from '../../src/types';
import { Data, MockConnection } from './MockConnection';
export class MockStream implements Stream {
  //protocol name
  public protocol: string;
  //local connection
  private connection: MockConnection;
  //data receiving channel
  private receiveChannel: Channel<{ _bufs: Buffer[] }>;
  //send data channel
  private sendChannel: Channel<Data>;
  //state variables
  private isAbort: boolean = false;
  //Initialize each data channel
  constructor(protocol: string, sendChannel: Channel<Data>, connection: MockConnection) {
    this.protocol = protocol;
    this.connection = connection;
    this.receiveChannel = new Channel<{ _bufs: Buffer[] }>();
    this.sendChannel = sendChannel;
  }

  //Push the iterator input data to the send channel
  sink = async (source: AsyncGenerator<Buffer, any, unknown>) => {
    while (!this.isAbort) {
      const { value } = await source.next();
      if (value !== undefined) {
        this.sendChannel.push({ protocol: this.protocol, data: { _bufs: [value] } });
      } else {
        continue;
      }
    }
  };

  //remote data iterator
  source = () => {
    return this.receiveChannel[Symbol.asyncIterator]();
  };

  //Close the stream (notify the connection to close both streams)
  close(): void {
    this.connection.handleStreamClose(this);
  }

  //Close the stream operation
  doClose(): void {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.receiveChannel.abort();
  }

  //Receive remote data
  handleData(data: { _bufs: Buffer[] }) {
    this.receiveChannel.push(data);
  }
}
