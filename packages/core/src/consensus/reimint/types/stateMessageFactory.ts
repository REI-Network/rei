import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { StateMachineMsg, StateMachineTimeout, StateMachineMessage, StateMachineEndHeight } from './stateMessages';

export class StateMachineMsgFactory {
  // disable constructor
  private constructor() {}

  static fromSerializedMessage(serialized: Buffer): StateMachineMsg {
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
    } else if (code === 2) {
      return StateMachineEndHeight.fromValuesArray(valuesArray);
    } else {
      throw new Error('invalid code');
    }
  }

  static serializeMessage(msg: StateMachineMsg) {
    let code: number;
    if (msg instanceof StateMachineMessage) {
      code = 0;
    } else if (msg instanceof StateMachineTimeout) {
      code = 1;
    } else if (msg instanceof StateMachineEndHeight) {
      code = 2;
    } else {
      throw new Error('invalid msg');
    }

    return rlp.encode([intToBuffer(code), msg.raw()]);
  }
}
