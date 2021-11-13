import { BN } from 'ethereumjs-util';
import { ConsensusAlgorithm, ConsensusType as EthereumConsensusType } from '@gxchain2/common';
import { nowTimestamp } from '@gxchain2/utils';
import { BlockHeader, CLIQUE_EXTRA_VANITY, CLIQUE_EXTRA_SEAL } from '@gxchain2/structure';
import { ConsensusType } from '../consensus/types';
import { getConsensusTypeByCommon } from '../hardforks';
import { getGasLimitByCommon, EMPTY_NONCE, EMPTY_ADDRESS, EMPTY_MIX_HASH } from '../utils';

const allowedFutureBlockTimeSeconds = 15;
const maxGasLimit = new BN('8000000000000000', 16);
let testnetHF1Number: BN | null = null;

export function preValidateHeader(this: BlockHeader, parentHeader: BlockHeader) {
  if (this.isGenesis()) {
    return;
  }
  const hardfork: string = (this as any)._getHardfork();
  // Consensus type dependent checks
  if (this._common.consensusAlgorithm() !== ConsensusAlgorithm.Clique && this._common.consensusAlgorithm() !== ConsensusAlgorithm.Reimint) {
    // PoW/Ethash
    if (this.extraData.length > this._common.paramByHardfork('vm', 'maxExtraDataSize', hardfork)) {
      const msg = 'invalid amount of extra data';
      throw this._error(msg);
    }
  } else {
    // PoA/Clique
    if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Clique) {
      const minLength = CLIQUE_EXTRA_VANITY + CLIQUE_EXTRA_SEAL;
      if (!this.cliqueIsEpochTransition()) {
        // ExtraData length on epoch transition
        if (this.extraData.length !== minLength) {
          const msg = `extraData must be ${minLength} bytes on non-epoch transition blocks, received ${this.extraData.length} bytes`;
          throw this._error(msg);
        }
      } else {
        const signerLength = this.extraData.length - minLength;
        if (signerLength % 20 !== 0) {
          const msg = `invalid signer list length in extraData, received signer length of ${signerLength} (not divisible by 20)`;
          throw this._error(msg);
        }
        // coinbase (beneficiary) on epoch transition
        if (!this.coinbase.isZero()) {
          const msg = `coinbase must be filled with zeros on epoch transition blocks, received ${this.coinbase.toString()}`;
          throw this._error(msg);
        }
      }
    }
    // MixHash format
    if (!this.mixHash.equals(EMPTY_MIX_HASH)) {
      const msg = `mixHash must be filled with zeros, received ${this.mixHash}`;
      throw this._error(msg);
    }
    // don't check clique difficulty
    // the clique difficulty should be checked before process block
    // if (!this.validateCliqueDifficulty(blockchain)) {
    //   const msg = 'invalid clique difficulty';
    //   throw this._error(msg);
    // }
    if (this.gasLimit.gte(maxGasLimit)) {
      throw this._error('invalid block with gas limit greater than (2^63 - 1)');
    }
    // additional check for beneficiary
    if (!this.nonce.equals(EMPTY_NONCE) || !this.coinbase.equals(EMPTY_ADDRESS)) {
      throw this._error('invalid header(nonce or coinbase), currently does not support beneficiary');
    }
    // additional check for timestamp
    if (!this.timestamp.gtn(nowTimestamp() + allowedFutureBlockTimeSeconds)) {
      throw this._error('invalid header(timestamp)');
    }
  }

  const { number } = this;
  if (!number.eq(parentHeader.number.addn(1))) {
    throw new Error('invalid number');
  }

  if (this.timestamp.lte(parentHeader.timestamp)) {
    throw new Error('invalid timestamp');
  }

  if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Clique || this._common.consensusAlgorithm() === ConsensusAlgorithm.Reimint) {
    const period = this._common.consensusConfig().period;
    // Timestamp diff between blocks is lower than PERIOD (clique)
    if (parentHeader.timestamp.addn(period).gt(this.timestamp)) {
      throw new Error('invalid timestamp diff (lower than period)');
    }
  }

  if (this._common.consensusAlgorithm() === ConsensusAlgorithm.Reimint) {
    if (!this.difficulty.eqn(1)) {
      throw new Error('invalid difficulty');
    }
  }

  if (this._common.consensusType() === EthereumConsensusType.ProofOfWork) {
    if (!this.validateDifficulty(parentHeader)) {
      throw new Error('invalid difficulty');
    }
  }

  const currentConsensusType = getConsensusTypeByCommon(this._common);
  const parentConsensusType = getConsensusTypeByCommon(parentHeader._common);

  if ((currentConsensusType === ConsensusType.Reimint && parentConsensusType === ConsensusType.Clique) || currentConsensusType === ConsensusType.Clique) {
    if (!this.gasLimit.eq(getGasLimitByCommon(this._common))) {
      throw new Error('invalid gas limit');
    }
  } else if (!this.validateGasLimit(parentHeader)) {
    throw new Error('invalid gas limit');
  }

  // don't check height
  //   if (height) {
  //     const dif = height.sub(parentHeader.number);
  //     if (!(dif.ltn(8) && dif.gtn(1))) {
  //       throw new Error('uncle block has a parent that is too old or too young');
  //     }
  //   }

  // check if the block used too much gas
  if (this.gasUsed.gt(this.gasLimit)) {
    throw new Error('Invalid block: too much gas used');
  }

  if (this._common.isActivatedEIP(1559)) {
    if (!this.baseFeePerGas) {
      throw new Error('EIP1559 block has no base fee field');
    }
    const block = this._common.hardforkBlockBN('london');
    const isInitialEIP1559Block = block && this.number.eq(block);
    if (isInitialEIP1559Block) {
      const initialBaseFee = new BN(this._common.param('gasConfig', 'initialBaseFee'));
      if (!this.baseFeePerGas!.eq(initialBaseFee)) {
        throw new Error('Initial EIP1559 block does not have initial base fee');
      }
    } else {
      // check if the base fee is correct
      const expectedBaseFee = parentHeader.calcNextBaseFee();

      if (!this.baseFeePerGas!.eq(expectedBaseFee)) {
        throw new Error('Invalid block: base fee not correct');
      }
    }
  }
}
