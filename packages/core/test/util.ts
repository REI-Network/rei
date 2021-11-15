import { Address } from 'ethereumjs-util';
import { FunctionalMap } from '@gxchain2/utils';

export class MockAccountManager {
  private nameToAddress = new Map<string, Address>();
  private nameToPrivKey = new Map<string, Buffer>();
  private addressToName = new FunctionalMap<Address, string>((a: Address, b: Address) => a.buf.compare(b.buf));

  constructor(addresses: [string, Address][] | [string, Address, Buffer][]) {
    for (const [name, address, privKey] of addresses) {
      this.nameToAddress.set(name, address);
      this.addressToName.set(address, name);
      if (privKey) {
        this.nameToPrivKey.set(name, privKey);
      }
    }
  }

  n2a(name: string) {
    const address = this.nameToAddress.get(name);
    if (!address) {
      throw new Error('missing name:' + name);
    }
    return address;
  }

  a2n(address: Address) {
    const name = this.addressToName.get(address);
    if (!name) {
      throw new Error('missing address:' + address.toString());
    }
    return name;
  }

  n2p(name: string) {
    const privKey = this.nameToPrivKey.get(name);
    if (!privKey) {
      throw new Error('missing name' + name);
    }
    return privKey;
  }

  a2p(address: Address) {
    return this.n2p(this.a2n(address));
  }
}
