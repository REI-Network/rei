import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
import { hexStringToBuffer } from '@rei-network/utils';

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

const errors = {
  PARSE_ERROR: {
    code: -32700,
    message: 'Parse error'
  },
  INVALID_REQUEST: {
    code: -32600,
    message: 'Invalid Request'
  },
  METHOD_NOT_FOUND: {
    code: -32601,
    message: 'Method not found'
  },
  INVALID_PARAMS: {
    code: -32602,
    message: 'Invalid params'
  },
  INTERNAL_ERROR: {
    code: -32603,
    message: 'Internal error'
  },
  SERVER_ERROR: {
    code: -32000,
    message: 'Server error'
  },
  REVERT_ERROR: {
    code: 3
  }
};

export class RevertError {
  readonly code = errors.REVERT_ERROR.code;
  readonly rpcMessage: string;
  readonly data?: string;

  constructor(returnValue: Buffer | string) {
    if (typeof returnValue === 'string') {
      this.rpcMessage = returnValue;
    } else {
      this.rpcMessage = 'execution reverted: ' + coder.decode(['string'], returnValue.slice(4))[0];
      this.data = bufferToHex(returnValue);
    }
  }
}

export class OutOfGasError {
  readonly code = errors.SERVER_ERROR.code;
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
              // TODO
              //   helper.throwRpcErr('Invalid topic type');
            }
            return hexStringToBuffer(subTopic);
          });
        } else {
          // TODO
          //   helper.throwRpcErr('Invalid topic type');
          // for types.
          return null;
        }
      })
    : [];
  return { addresses, topics };
}
