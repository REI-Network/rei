import { BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { ConsensusMessage, ConsensusMessageFactory } from '../../protocols/consensus/messages';
import * as v from '../validate';
import { RoundStepType } from '../enum';

export interface StateMachineMsg {
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class StateMachineMessage implements StateMachineMsg {
  readonly peerId: string;
  readonly msg: ConsensusMessage;

  constructor(peerId: string, msg: ConsensusMessage) {
    this.peerId = peerId;
    this.msg = msg;
    this.validateBasic();
  }

  static readonly code = 0;

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [peerIdBuffer, messageValues] = values;
    if (!(peerIdBuffer instanceof Buffer) || !Array.isArray(messageValues)) {
      throw new Error('invalid values');
    }
    return new StateMachineMessage(peerIdBuffer.toString(), ConsensusMessageFactory.fromValuesArray(messageValues));
  }

  raw() {
    return [Buffer.from(this.peerId), ConsensusMessageFactory.rawMessage(this.msg)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    // do nothong
  }
}

export class StateMachineTimeout implements StateMachineMsg {
  readonly duration: number;
  readonly height: BN;
  readonly round: number;
  readonly step: RoundStepType;

  constructor(duration: number, height: BN, round: number, step: RoundStepType) {
    this.duration = duration;
    this.height = height.clone();
    this.round = round;
    this.step = step;
    this.validateBasic();
  }

  static readonly code = 1;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 4) {
      throw new Error('invalid values');
    }

    const [durationBuffer, heightBuffer, roundBuffer, stepBuffer] = values;
    return new StateMachineTimeout(bufferToInt(durationBuffer), new BN(heightBuffer), bufferToInt(roundBuffer), bufferToInt(stepBuffer));
  }

  raw() {
    return [intToBuffer(this.duration), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.step)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateStep(this.step);
  }
}

export class StateMachineEndHeight implements StateMachineMsg {
  readonly height: BN;

  constructor(height: BN) {
    this.height = height.clone();
    this.validateBasic();
  }

  static readonly code = 2;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 1) {
      throw new Error('invalid values');
    }

    const [heightBuffer] = values;
    return new StateMachineEndHeight(new BN(heightBuffer));
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHeight(this.height);
  }
}
