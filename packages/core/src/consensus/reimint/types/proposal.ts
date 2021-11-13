import { Address, BN, intToBuffer, ecsign, ecrecover, rlphash, bnToUnpaddedBuffer, rlp, bufferToInt } from 'ethereumjs-util';
import { VoteType } from './vote';
import * as v from './validate';

export interface ProposalData {
  type: VoteType;
  height: BN;
  round: number;
  POLRound: number;
  hash: Buffer;
}

export class Proposal {
  readonly type: VoteType;
  readonly height: BN;
  readonly round: number;
  readonly POLRound: number;
  readonly hash: Buffer;
  private _signature?: Buffer;

  static fromSerializedProposal(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized proposal input. must be array');
    }
    return Proposal.fromValuesArray(values as any);
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 6) {
      throw new Error('invalid proposal');
    }

    const [type, height, round, POLRound, hash, signature] = values;

    return new Proposal(
      {
        type: bufferToInt(type),
        height: new BN(height),
        round: bufferToInt(round),
        POLRound: bufferToInt(POLRound) - 1,
        hash
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
    this._signature = signature;
    this.validateBasic();
  }

  get signature(): Buffer | undefined {
    return this._signature;
  }

  set signature(signature: Buffer | undefined) {
    if (signature !== undefined) {
      v.validateSignature(signature);
      this._signature = signature;
    }
  }

  getMessageToSign() {
    return rlphash([intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash]);
  }

  isSigned() {
    return this._signature && this._signature.length > 0;
  }

  sign(privateKey: Buffer) {
    const { r, s, v } = ecsign(this.getMessageToSign(), privateKey);
    this.signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
  }

  raw() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    return [intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash, this._signature!];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    if (this.type !== VoteType.Proposal) {
      throw new Error('invalid vote type');
    }
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validatePOLRound(this.POLRound);
    v.validateHash(this.hash);
    if (this.isSigned()) {
      v.validateSignature(this._signature!);
    }
  }

  validateSignature(proposer: Address) {
    const recoveredProposer = this.proposer();
    if (!proposer.equals(recoveredProposer)) {
      throw new Error('invalid signature');
    }
  }

  proposer() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    const r = this._signature!.slice(0, 32);
    const s = this._signature!.slice(32, 64);
    const v = new BN(this._signature!.slice(64, 65)).addn(27);
    return Address.fromPublicKey(ecrecover(this.getMessageToSign(), v, r, s));
  }
}
