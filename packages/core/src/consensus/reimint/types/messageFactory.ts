import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { ContructorWithCode, Registry } from './registry';
import * as m from './messages';
import { Message } from './messages';

export interface MessageConstructor extends ContructorWithCode<Message> {
  fromValuesArray(values: any[]): Message;
}

export class MessageFactory {
  // disable constructor
  private constructor() {}

  static registry = new Registry<Message, MessageConstructor>();

  /**
   * Create a message instance from a serialized buffer
   * @param serialized - Serialized buffer
   * @returns Message instance
   */
  static fromSerializedMessage(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized');
    }
    return MessageFactory.fromValuesArray(values);
  }

  /**
   * Create a message instance from raw value
   * @param values - Raw value
   * @returns Message instance
   */
  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 2) {
      throw new Error('invalid serialized');
    }

    const [codeBuffer, valuesArray] = values;
    if (!(codeBuffer instanceof Buffer) || !Array.isArray(valuesArray) || valuesArray.length === 0) {
      throw new Error('invalid serialized');
    }

    return MessageFactory.registry.getCtorByCode(bufferToInt(codeBuffer)).fromValuesArray(valuesArray);
  }

  /**
   * Convert a message instance to raw value
   * @param _message - Message instance
   * @returns Raw value
   */
  static rawMessage<T extends Message>(_message: T) {
    const code = MessageFactory.registry.getCodeByInstance(_message);
    return [intToBuffer(code), _message.raw()];
  }

  /**
   * Serialize a message instance to a buffer
   * @param _message - Message instance
   * @returns Serialized buffer
   */
  static serializeMessage<T extends Message>(_message: T) {
    return rlp.encode(MessageFactory.rawMessage(_message));
  }
}

MessageFactory.registry.register(m.NewRoundStepMessage);
MessageFactory.registry.register(m.NewValidBlockMessage);
MessageFactory.registry.register(m.HasVoteMessage);
MessageFactory.registry.register(m.ProposalMessage);
MessageFactory.registry.register(m.ProposalPOLMessage);
MessageFactory.registry.register(m.VoteMessage);
MessageFactory.registry.register(m.VoteSetMaj23Message);
MessageFactory.registry.register(m.VoteSetBitsMessage);
MessageFactory.registry.register(m.GetProposalBlockMessage);
MessageFactory.registry.register(m.ProposalBlockMessage);
