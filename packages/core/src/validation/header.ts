import { BN, Address } from 'ethereumjs-util';
import { ConsensusAlgorithm } from '@gxchain2/common';
import { hexStringToBN, nowTimestamp } from '@gxchain2/utils';
import { BlockHeader, CLIQUE_EXTRA_VANITY, CLIQUE_EXTRA_SEAL, preHF1CalcCliqueDifficulty, CLIQUE_DIFF_INTURN, CLIQUE_DIFF_NOTURN } from '@gxchain2/structure';
import { Blockchain } from '@gxchain2/blockchain';

const allowedFutureBlockTimeSeconds = 15;
const maxGasLimit = new BN('8000000000000000', 16);

export function preValidateHeader(this: BlockHeader, parentHeader: BlockHeader) {
  if (this.isGenesis()) {
    return;
  }
  const hardfork: string = (this as any)._getHardfork();
  // Consensus type dependent checks
  if (this._common.consensusAlgorithm() !== ConsensusAlgorithm.Clique) {
    // PoW/Ethash
    if (this.extraData.length > this._common.paramByHardfork('vm', 'maxExtraDataSize', hardfork)) {
      const msg = 'invalid amount of extra data';
      throw this._error(msg);
    }
  } else {
    // PoA/Clique
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
    // MixHash format
    if (!this.mixHash.equals(Buffer.alloc(32))) {
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
    if (!this.nonce.equals(Buffer.alloc(8)) || !this.coinbase.equals(Address.zero())) {
      throw this._error('invalid header(nonce or coinbase), currently does not support beneficiary');
    }
    // additional check for gasLimit
    if (!this.gasLimit.eq(hexStringToBN(this._common.param('gasConfig', 'gasLimit')))) {
      throw this._error('invalid header(gas limit)');
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

  if (this._common.consensusAlgorithm() === 'clique') {
    const period = this._common.consensusConfig().period;
    // Timestamp diff between blocks is lower than PERIOD (clique)
    if (parentHeader.timestamp.addn(period).gt(this.timestamp)) {
      throw new Error('invalid timestamp diff (lower than period)');
    }
  }

  if (this._common.consensusType() === 'pow') {
    if (!this.validateDifficulty(parentHeader)) {
      throw new Error('invalid difficulty');
    }
  }

  if (!this.validateGasLimit(parentHeader)) {
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

export function preHF1ConsensusValidateHeader(this: BlockHeader, blockchain: Blockchain) {
  const miner = this.cliqueSigner();
  const activeSigners = blockchain.cliqueActiveSignersByBlockNumber(this.number);
  if (activeSigners.findIndex((addr) => addr.equals(miner)) === -1) {
    throw new Error('invalid validator, missing from active signer');
  }
  const [, diff] = preHF1CalcCliqueDifficulty(activeSigners, this.cliqueSigner(), this.number);
  if (!diff.eq(this.difficulty)) {
    throw new Error('invalid difficulty');
  }
  if ((blockchain as any).cliqueCheckRecentlySigned(this)) {
    throw new Error('clique recently signed');
  }
}

export function consensusValidateHeader(this: BlockHeader, activeSigners: Address[], proposer: Address) {
  const miner = this.cliqueSigner();
  if (activeSigners.findIndex((addr) => addr.equals(miner)) === -1) {
    throw new Error('invalid validator, missing from active signer');
  }
  if (miner.equals(proposer) && !this.difficulty.eq(CLIQUE_DIFF_INTURN)) {
    throw new Error('invalid difficulty');
  }
  if (!miner.equals(proposer) && !this.difficulty.eq(CLIQUE_DIFF_NOTURN)) {
    throw new Error('invalid difficulty');
  }
}
