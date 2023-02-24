import { Address } from 'ethereumjs-util';
import { FunctionalMap } from '@rei-network/utils';
import { SecretKey } from '@rei-network/bls';

export class MockAccountManager {
  readonly nameToAddress = new Map<string, Address>();
  readonly nameToPrivKey = new Map<string, Buffer>();
  readonly addressToName = new FunctionalMap<Address, string>((a: Address, b: Address) => a.buf.compare(b.buf));
  readonly nameToBlsKey = new Map<string, SecretKey>();

  constructor(addresses: [string, Address][] | [string, Address, Buffer][] | [string, Address, Buffer, SecretKey][]) {
    this.add(addresses);
  }

  add(addresses: [string, Address][] | [string, Address, Buffer][] | [string, Address, Buffer, SecretKey][]) {
    for (const [name, address, privKey, blsSecretKey] of addresses) {
      this.nameToAddress.set(name, address);
      this.addressToName.set(address, name);
      if (privKey) {
        this.nameToPrivKey.set(name, privKey);
      }
      if (blsSecretKey) {
        this.nameToBlsKey.set(name, blsSecretKey);
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

  n2b(name: string) {
    const blsSecretKey = this.nameToBlsKey.get(name);
    if (!blsSecretKey) {
      throw new Error('missing name' + name);
    }
    return blsSecretKey;
  }
}
