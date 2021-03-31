import { v4 as uuidv4 } from 'uuid';

export class WsClient {
  public readonly id: string;
  public readonly ws: WebSocket;
  private closed = false;

  get isClosed() {
    return this.closed;
  }

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.id = uuidv4();
  }

  send(data: any) {
    if (!this.closed) {
      try {
        this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      } catch (err) {}
    }
  }

  close() {
    this.closed = true;
  }
}
