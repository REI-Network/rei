import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { ContructorWithCode, Registry } from '../registry';
import * as s from './stateMessages';
import { StateMachineMsg } from './stateMessages';

export interface StateMachineMsgContrutor extends ContructorWithCode<StateMachineMsg> {
  fromValuesArray(values: any[]): StateMachineMsg;
}

export class StateMachineMsgFactory {
  // disable constructor
  private constructor() {}

  static registry = new Registry<StateMachineMsg, StateMachineMsgContrutor>();

  static fromSerializedMessage(serialized: Buffer): StateMachineMsg {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values) || values.length !== 2) {
      throw new Error('invalid values');
    }

    const [codeBuffer, valuesArray] = values;
    if (!(codeBuffer instanceof Buffer) || !Array.isArray(valuesArray) || valuesArray.length === 0) {
      throw new Error('invalid values');
    }

    return StateMachineMsgFactory.registry.getCtorByCode(bufferToInt(codeBuffer)).fromValuesArray(valuesArray);
  }

  static serializeMessage(msg: StateMachineMsg) {
    const code = StateMachineMsgFactory.registry.getCodeByInstance(msg);
    return rlp.encode([intToBuffer(code), msg.raw()]);
  }
}

StateMachineMsgFactory.registry.register(s.StateMachineMessage);
StateMachineMsgFactory.registry.register(s.StateMachineTimeout);
StateMachineMsgFactory.registry.register(s.StateMachineEndHeight);
