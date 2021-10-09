import { ConsensusEngine, ConsensusEngineConstructor, ConsensusEngineOptions } from './consensusEngine';
import { CliqueConsensusEngine } from './clique';
import { ReimintConsensusEngine } from './reimint';

export * from './consensusEngine';
export * from './clique';
export * from './reimint';

export enum ConsensusType {
  Clique,
  Reimint
}

export const engines = new Map<ConsensusType, ConsensusEngineConstructor>([
  [ConsensusType.Clique, CliqueConsensusEngine],
  [ConsensusType.Reimint, ReimintConsensusEngine]
]);

export function createEnginesByConsensusTypes(types: ConsensusType[], options: ConsensusEngineOptions) {
  return new Map<ConsensusType, ConsensusEngine>(types.map((type) => [type, new (engines.get(type)!)(options)]));
}
