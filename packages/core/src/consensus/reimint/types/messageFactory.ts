import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import * as m from './messages';
import { Message } from './messages';

export interface MessageConstructor {
  new (...data: any[]): Message;
  fromValuesArray(values: any[]): Message;
}

const messageToCode = new Map<MessageConstructor, number>();
const codeToMessage = new Map<number, MessageConstructor>();

function registerMessage(eles: [MessageConstructor, number][]) {
  for (const [message, code] of eles) {
    messageToCode.set(message, code);
    codeToMessage.set(code, message);
  }
}

registerMessage([
  [m.NewRoundStepMessage, 0],
  [m.NewValidBlockMessage, 1],
  [m.HasVoteMessage, 2],
  [m.ProposalMessage, 3],
  [m.ProposalPOLMessage, 4],
  [m.VoteMessage, 5],
  [m.VoteSetMaj23Message, 6],
  [m.VoteSetBitsMessage, 7],
  [m.GetProposalBlockMessage, 8],
  [m.ProposalBlockMessage, 9]
]);

export class MessageFactory {
  // disable constructor
  private constructor() {}

  /**
   * Get message code by message constructor
   * @param message - Message constructor
   * @returns Message code
   */
  static getCodeByMessage(message: MessageConstructor) {
    const code = messageToCode.get(message);
    if (code === undefined) {
      throw new Error('unknown message');
    }
    return code;
  }

  /**
   * Get message code by message instance
   * @param _message - Message instance
   * @returns Message code
   */
  static getCodeByMessageInstance<T extends Message>(_message: T) {
    for (const [code, message] of codeToMessage) {
      if (_message instanceof message) {
        return code;
      }
    }
    throw new Error('unknown message');
  }

  /**
   * Get message contructor by message code
   * @param code - Message code
   * @returns Message constructor
   */
  static getMessageByCode(code: number) {
    const message = codeToMessage.get(code);
    if (message === undefined) {
      throw new Error(`unknown code: ${code}`);
    }
    return message;
  }

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

    return MessageFactory.getMessageByCode(bufferToInt(codeBuffer)).fromValuesArray(valuesArray);
  }

  /**
   * Convert a message instance to raw value
   * @param _message - Message instance
   * @returns Raw value
   */
  static rawMessage<T extends Message>(_message: T) {
    const code = MessageFactory.getCodeByMessageInstance(_message);
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
