import { Address, BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { Evidence, Message, MessageFactory } from '../types';
import * as v from '../types/validate';

export interface Signer {
  address(): Address;
  sign(msg: Buffer): Buffer;
}

export interface Config {
  proposeDuration(round: number): number;
  prevoteDuration(round: number): number;
  precommitDutaion(round: number): number;
}

export interface EvidencePool {
  addEvidence(ev: Evidence): Promise<void>;
  pickEvidence(height: BN, count: number): Promise<Evidence[]>;
}

export enum RoundStepType {
  NewHeight = 1,
  NewRound,
  Propose,
  Prevote,
  PrevoteWait,
  Precommit,
  PrecommitWait,
  Commit
}

export interface StateMachineMsg {
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class StateMachineMessage implements StateMachineMsg {
  readonly peerId: string;
  readonly msg: Message;

  constructor(peerId: string, msg: Message) {
    this.peerId = peerId;
    this.msg = msg;
  }

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [peerIdBuffer, messageValues] = values;
    if (!(peerIdBuffer instanceof Buffer) || !Array.isArray(messageValues)) {
      throw new Error('invalid values');
    }
    return new StateMachineMessage(peerIdBuffer.toString(), MessageFactory.fromValuesArray(messageValues));
  }

  raw() {
    return [Buffer.from(this.peerId), MessageFactory.rawMessage(this.msg)];
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

export class StateMachineMsgFactory {
  // disable constructor
  private constructor() {}

  static fromSerialized(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values) || values.length < 2) {
      throw new Error('invalid values');
    }

    const [codeBuffer, valuesArray] = values;
    if (!(codeBuffer instanceof Buffer) || !Array.isArray(valuesArray) || valuesArray.length === 0) {
      throw new Error('invalid values');
    }

    const code = bufferToInt(codeBuffer);
    if (code === 0) {
      return StateMachineMessage.fromValuesArray(valuesArray);
    } else if (code === 1) {
      return StateMachineTimeout.fromValuesArray(valuesArray);
    } else {
      throw new Error('invalid code');
    }
  }

  static serialize(msg: StateMachineMsg) {
    let code: number;
    if (msg instanceof StateMachineMessage) {
      code = 0;
    } else if (msg instanceof StateMachineTimeout) {
      code = 1;
    } else {
      throw new Error('invalid msg');
    }

    return rlp.encode([intToBuffer(code), msg.raw()]);
  }
}

export interface SendMessageOptions {
  // broadcast the message but exlcude the target peers
  exclude?: string[];
  // send message to target peer
  to?: string;
  // boardcast the message to all peers
  broadcast?: boolean;
}

export interface StateMachineBackend {
  broadcastMessage(msg: Message, options: SendMessageOptions): void;
  executeBlock(block: Block, options: any /*TODO*/): Promise<boolean>;
}
