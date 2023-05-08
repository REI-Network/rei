import { Address, BN, intToBuffer, ecsign, ecrecover, rlphash, bnToUnpaddedBuffer, rlp, bufferToInt, toBuffer } from 'ethereumjs-util';
import { importBls } from '@rei-network/bls';
import { ActiveValidatorSet } from './validatorSet';
import { VoteType, SignatureType } from './enum';
import * as v from './validate';

export interface ProposalData {
  type: VoteType;
  height: BN;
  round: number;
  POLRound: number;
  hash: Buffer;
  proposer?: Address;
}

export class Proposal {
  readonly type: VoteType;
  readonly height: BN;
  readonly round: number;
  readonly POLRound: number;
  readonly hash: Buffer;
  readonly proposer?: Address;

  readonly signatureType: SignatureType;
  private _signature?: Buffer;

  /**
   * Create a new proposal from a serialized proposal.
   * @param serialized - Serialized proposal
   * @returns Proposal
   */
  static fromSerializedProposal(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized proposal input. must be array');
    }
    return Proposal.fromValuesArray(values as any);
  }

  /**
   * Create a new proposal from values array
   * @param values - Values array
   * @returns Proposal
   */
  static fromValuesArray(values: Buffer[]) {
    if (values.length === 6) {
      const [type, height, round, POLRound, hash, signature] = values;
      return new Proposal(
        {
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          POLRound: bufferToInt(POLRound) - 1,
          hash
        },
        SignatureType.ECDSA,
        signature
      );
    } else if (values.length === 7) {
      const [type, height, round, POLRound, hash, proposer, signature] = values;
      return new Proposal(
        {
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          POLRound: bufferToInt(POLRound) - 1,
          hash,
          proposer: new Address(proposer)
        },
        SignatureType.BLS,
        signature
      );
    } else {
      throw new Error('invalid values length');
    }
  }

  constructor(data: ProposalData, signatureType: SignatureType, signature?: Buffer) {
    this.type = data.type;
    this.height = data.height.clone();
    this.round = data.round;
    this.POLRound = data.POLRound;
    this.hash = data.hash;
    this.proposer = data.proposer;
    this.signatureType = signatureType;
    this._signature = signature;
    this.validateBasic();
  }

  /**
   * Get signature
   */
  get signature(): Buffer | undefined {
    return this._signature;
  }

  /**
   * Set signature
   */
  set signature(signature: Buffer | undefined) {
    if (signature !== undefined) {
      if (this.signatureType === SignatureType.ECDSA) {
        v.validateSignature(signature);
      } else {
        v.validateBlsSignature(signature);
      }
      this._signature = signature;
    }
  }

  /**
   * Get message to sign
   * @returns Message to sign
   */
  getMessageToSign() {
    return rlphash([intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash]);
  }

  /**
   * Get proposer address
   * @returns Proposer address
   */
  getProposer() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (this.signatureType === SignatureType.ECDSA) {
      const r = this._signature!.slice(0, 32);
      const s = this._signature!.slice(32, 64);
      const v = new BN(this._signature!.slice(64, 65)).addn(27);
      return Address.fromPublicKey(ecrecover(this.getMessageToSign(), v, r, s));
    } else {
      return this.proposer!;
    }
  }

  /**
   * Is vote signed
   * @returns True if vote is signed, false otherwise
   */
  isSigned() {
    return this._signature && this._signature.length > 0;
  }

  /**
   * Sign proposal
   * @param privateKey - ECDSA or BLS private key
   */
  sign(privateKey: Buffer) {
    if (this.signatureType === SignatureType.ECDSA) {
      const { r, s, v } = ecsign(this.getMessageToSign(), privateKey);
      this.signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
    } else {
      this.signature = Buffer.from(importBls().sign(privateKey, this.getMessageToSign()));
    }
  }

  /**
   * Proposal raw data
   * @returns Raw data
   */
  raw() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (this.signatureType === SignatureType.ECDSA) {
      return [intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash, this._signature!];
    } else {
      return [intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.POLRound + 1), this.hash, toBuffer(this.proposer!), this._signature!];
    }
  }

  /**
   * Proposal serialized data
   * @returns Serialized data
   */
  serialize() {
    return rlp.encode(this.raw());
  }

  /**
   * Validate proposal basicly
   */
  validateBasic() {
    if (this.type !== VoteType.Proposal) {
      throw new Error('invalid vote type');
    }
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validatePOLRound(this.POLRound);
    v.validateHash(this.hash);
    if (this.signatureType === SignatureType.BLS) {
      if (!this.proposer) {
        throw new Error('missing proposer address');
      }
    }
    if (this.isSigned()) {
      if (this.signatureType === SignatureType.ECDSA) {
        v.validateSignature(this._signature!);
      } else {
        v.validateBlsSignature(this._signature!);
      }
    }
  }

  /**
   * Validate proposal signature
   * @param valSet - Active validator set
   */
  validateSignature(valSet: ActiveValidatorSet) {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (!valSet.proposer.equals(this.getProposer())) {
      throw new Error('invalid signature');
    }
    if (this.signatureType === SignatureType.BLS) {
      if (!importBls().verify(valSet.getBlsPublicKey(valSet.proposer), this.getMessageToSign(), this.signature!)) {
        throw new Error('invalid signature');
      }
    }
  }
}
