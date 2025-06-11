import { rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { ContructorWithCode, Registry } from '@rei-network/utils';
import * as m from './messages';
import { ConsensusMessage } from './messages';

export interface ConsensusMessageConstructor
  extends ContructorWithCode<ConsensusMessage> {
  fromValuesArray(values: any[]): ConsensusMessage;
}

export abstract class ConsensusMessageFactory {
  static registry = new Registry<
    ConsensusMessage,
    ConsensusMessageConstructor
  >();

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
    return ConsensusMessageFactory.fromValuesArray(values);
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
    if (
      !(codeBuffer instanceof Buffer) ||
      !Array.isArray(valuesArray) ||
      valuesArray.length === 0
    ) {
      throw new Error('invalid serialized');
    }

    return ConsensusMessageFactory.registry
      .getCtorByCode(bufferToInt(codeBuffer))
      .fromValuesArray(valuesArray);
  }

  /**
   * Convert a message instance to raw value
   * @param _message - Message instance
   * @returns Raw value
   */
  static rawMessage<T extends ConsensusMessage>(_message: T) {
    const code = ConsensusMessageFactory.registry.getCodeByInstance(_message);
    return [intToBuffer(code), _message.raw()];
  }

  /**
   * Serialize a message instance to a buffer
   * @param _message - Message instance
   * @returns Serialized buffer
   */
  static serializeMessage<T extends ConsensusMessage>(_message: T) {
    return rlp.encode(ConsensusMessageFactory.rawMessage(_message));
  }
}

ConsensusMessageFactory.registry.register(m.NewRoundStepMessage);
ConsensusMessageFactory.registry.register(m.NewValidBlockMessage);
ConsensusMessageFactory.registry.register(m.HasVoteMessage);
ConsensusMessageFactory.registry.register(m.ProposalMessage);
ConsensusMessageFactory.registry.register(m.ProposalPOLMessage);
ConsensusMessageFactory.registry.register(m.VoteMessage);
ConsensusMessageFactory.registry.register(m.VoteSetMaj23Message);
ConsensusMessageFactory.registry.register(m.VoteSetBitsMessage);
ConsensusMessageFactory.registry.register(m.GetProposalBlockMessage);
ConsensusMessageFactory.registry.register(m.ProposalBlockMessage);
ConsensusMessageFactory.registry.register(m.DuplicateVoteEvidenceMessage);
ConsensusMessageFactory.registry.register(m.HandshakeMessage);
