import { BN } from 'ethereumjs-util';
import { VoteType } from './vote';
import { RoundStepType } from './types';

export function validateHeight(height: BN) {
  if (height.isNeg()) {
    throw new Error('invalid height');
  }
}

export function validateRound(round: number) {
  if (round < 0 || !Number.isSafeInteger(round)) {
    throw new Error('invalid round');
  }
}

export function validatePOLRound(POLRound: number) {
  if (POLRound < -1 || POLRound >= Number.MAX_SAFE_INTEGER - 1) {
    throw new Error('invalid POLRound');
  }
}

export function validateStep(step: RoundStepType) {
  if (step !== RoundStepType.Propose && step !== RoundStepType.PrevoteWait && step !== RoundStepType.Prevote && step !== RoundStepType.PrecommitWait && step !== RoundStepType.Precommit && step !== RoundStepType.NewRound && step !== RoundStepType.NewHeight && step !== RoundStepType.Commit) {
    throw new Error('invalid step');
  }
}

export function validateHash(hash: Buffer) {
  if (hash.length !== 32) {
    throw new Error('invalid hash');
  }
}

export function validateSignature(signature: Buffer) {
  if (signature.length !== 65) {
    throw new Error('invalid signature');
  }
}

export function validateBlsSignature(blsSignature: Buffer) {
  if (blsSignature.length !== 96) {
    throw new Error('invalid bls signature');
  }
}

export function validateTimestamp(timestamp: number) {
  if (timestamp < 0 || !Number.isSafeInteger(timestamp)) {
    throw new Error('invalid timestamp');
  }
}

export function validateIndex(index: number) {
  if (index < 0 || !Number.isSafeInteger(index)) {
    throw new Error('invalid timestamp');
  }
}

export function validateVoteType(type: VoteType) {
  if (type !== VoteType.Precommit && type !== VoteType.Prevote) {
    throw new Error('invalid vote type');
  }
}
