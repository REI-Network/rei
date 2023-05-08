export enum RoundStepType {
  NewHeight = 1,
  NewRound,
  Propose,
  Prevote,
  PrevoteWait,
  Precommit,
  PrecommitWait,
  Commit
}

export enum SignatureType {
  ECDSA,
  BLS
}

export enum VoteType {
  Proposal,
  Prevote,
  Precommit
}
