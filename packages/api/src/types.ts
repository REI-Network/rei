import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
import { hexStringToBuffer } from '@rei-network/utils';

export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export type TopicsData = (string | null | (string | null)[])[];

export type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string;
};

const coder = new AbiCoder();

// keccak256("Error(string)").slice(0, 4)
export const revertErrorSelector = Buffer.from('08c379a0', 'hex');

export class RevertError {
  readonly returnValue: Buffer | string;

  constructor(returnValue: Buffer | string) {
    this.returnValue = returnValue;
  }
}

export class OutOfGasError {
  readonly gas: BN;

  constructor(gas: BN) {
    this.gas = gas.clone();
  }

  get rpcMessage() {
    return `gas required exceeds allowance (${this.gas.toString()})`;
  }
}

export function parseAddressesAndTopics(_addresses?: string | string[], _topics?: TopicsData) {
  const addresses: Address[] = typeof _addresses === 'string' ? [Address.fromString(_addresses)] : _addresses?.map((addr) => Address.fromString(addr)) ?? [];
  const topics: (Buffer | null | (Buffer | null)[])[] = _topics
    ? _topics.map((topic) => {
        if (topic === null) {
          return null;
        } else if (typeof topic === 'string') {
          return hexStringToBuffer(topic);
        } else if (Array.isArray(topic)) {
          return topic.map((subTopic) => {
            if (subTopic === null) {
              return null;
            }
            if (typeof subTopic !== 'string') {
              throw new Error('Invalid topic type');
            }
            return hexStringToBuffer(subTopic);
          });
        } else {
          throw new Error('Invalid topic type');
        }
      })
    : [];
  return { addresses, topics };
}
