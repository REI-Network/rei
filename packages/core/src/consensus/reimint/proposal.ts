import { Address, BN, intToBuffer, ecsign, ecrecover, rlphash, bnToUnpaddedBuffer, rlp, bufferToInt } from 'ethereumjs-util';
import { VoteType } from './vote';

export interface ProposalData {
  type: VoteType;
  height: BN;
  round: number;
  POLRound: number;
  hash: Buffer;
  timestamp: number;
}

export class Proposal {
  type: VoteType;
  height: BN;
  round: number;
  POLRound: number;
  hash: Buffer;
  timestamp: number;
  signature?: Buffer;

  static fromSerializedProposal(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized proposal input. must be array');
    }
    return Proposal.fromValuesArray(values as any);
  }

  static fromValuesArray(values: [Buffer, Buffer, Buffer, Buffer, Buffer, Buffer, Buffer]) {
    if (values.length !== 7) {
      throw new Error('invalid proposal');
    }

    const [type, height, round, POLRound, hash, timestamp, signature] = values;

    return new Proposal(
      {
        type: bufferToInt(type),
        height: new BN(height),
        round: bufferToInt(round),
        POLRound: bufferToInt(POLRound) - 1,
        hash,
        timestamp: bufferToInt(timestamp)
      },
      signature
    );
  }

  constructor(data: ProposalData, signature?: Buffer) {
    this.type = data.type;
    this.height = data.height.clone();
    this.round = data.round;
    this.POLRound = data.POLRound;
    this.hash = data.hash;
    this.timestamp = data.timestamp;
    this.signature = signature;
  }

  getMessageToSign() {
    return rlphash([intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash, intToBuffer(this.timestamp)]);
  }

  isSigned() {
    return !!this.signature;
  }

  sign(privateKey: Buffer) {
    const { r, s, v } = ecsign(this.getMessageToSign(), privateKey);
    this.signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
  }

  raw() {
    if (!this.signature) {
      throw new Error('missing signature');
    }
    return [intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash, intToBuffer(this.timestamp), this.signature];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    // TODO: ...
  }

  validateSignature(proposer: Address) {
    const recoveredProposer = this.proposer();
    if (!proposer.equals(recoveredProposer)) {
      throw new Error('invalid signature');
    }
  }

  proposer() {
    const r = this.signature!.slice(0, 32);
    const s = this.signature!.slice(32, 64);
    const v = new BN(this.signature!.slice(64, 65)).addn(27);
    return Address.fromPublicKey(ecrecover(this.getMessageToSign(), v, r, s));
  }
}
