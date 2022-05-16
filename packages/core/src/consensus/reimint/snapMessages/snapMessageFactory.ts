import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { SnapMessage } from './snapMessages';
import * as s from './snapMessages';
import { ContructorWithCode, Registry } from '../registry';

export interface SnapMessageContrutor extends ContructorWithCode<SnapMessage> {
  fromValuesArray(values: any[]): SnapMessage;
}

export class SnapMessageFactory {
  private constructor() {}

  static registry = new Registry<SnapMessage, SnapMessageContrutor>();

  static fromSerializedMessage(serialized: Buffer): SnapMessage {
    const values = rlp.decode(serialized);

    if (!Array.isArray(values)) {
      throw new Error('invaild serialized');
    }

    return SnapMessageFactory.fromValuesArray(values);
  }

  static fromValuesArray(values: any[]) {
    if (values.length < 2) {
      throw new Error('invaild evidence values');
    }

    const [codeBuffer, valuesArray] = values;
    if (!(codeBuffer instanceof Buffer) || !Array.isArray(valuesArray) || valuesArray.length === 0) {
      throw new Error('invalid evidence values');
    }

    return SnapMessageFactory.registry.getCtorByCode(bufferToInt(codeBuffer)).fromValuesArray(valuesArray);
  }

  static rawMessage<T extends SnapMessage>(_snapmessage: T) {
    const code = SnapMessageFactory.registry.getCodeByInstance(_snapmessage);
    return [intToBuffer(code), _snapmessage.raw()];
  }

  static serializedMessage<T extends SnapMessage>(_snapmessage: T) {
    return rlp.encode(SnapMessageFactory.rawMessage(_snapmessage));
  }
}

SnapMessageFactory.registry.register(s.AccountRange);
SnapMessageFactory.registry.register(s.GetAccountRange);
SnapMessageFactory.registry.register(s.ByteCode);
SnapMessageFactory.registry.register(s.GetByteCode);
SnapMessageFactory.registry.register(s.StorageRange);
SnapMessageFactory.registry.register(s.GetStorageRange);
SnapMessageFactory.registry.register(s.GetTrieNode);
SnapMessageFactory.registry.register(s.TrieNode);
