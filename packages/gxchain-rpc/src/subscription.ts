import { uuidv4 } from 'uuid';

function randomIDGenetator(): string {
  return uuidv4();
}

class Subscription {
  ID: string;
  namespace: string;
  activated: boolean;
  constructor(namespace: string) {
    this.ID = randomIDGenetator();
    this.namespace = namespace;
    this.activated = true;
  }

  notify(id: string, data: any) {
    if (this.ID != id) {
      ws.send('Notify with wrong ID');
      return;
    }
    if (this.activated) {
      ws.send(JSON.stringify(data));
    }
  }
}
