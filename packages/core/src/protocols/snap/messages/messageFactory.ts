import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { ContructorWithCode, Registry } from '../../../utils';
import * as m from './messages';
import { SnapMessage } from './messages';

export interface SnapMessageContrutor extends ContructorWithCode<SnapMessage> {
  fromValuesArray(values: any[]): SnapMessage;
}

export abstract class SnapMessageFactory {
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

  static serializeMessage<T extends SnapMessage>(_snapmessage: T) {
    return rlp.encode(SnapMessageFactory.rawMessage(_snapmessage));
  }
}

SnapMessageFactory.registry.register(m.GetAccountRange);
SnapMessageFactory.registry.register(m.AccountRange);
SnapMessageFactory.registry.register(m.GetStorageRange);
SnapMessageFactory.registry.register(m.StorageRange);
SnapMessageFactory.registry.register(m.GetByteCode);
SnapMessageFactory.registry.register(m.ByteCode);
SnapMessageFactory.registry.register(m.GetTrieNode);
SnapMessageFactory.registry.register(m.TrieNode);
