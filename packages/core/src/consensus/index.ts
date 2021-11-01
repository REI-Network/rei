import { CliqueConsensusEngine } from './clique';
import { ReimintConsensusEngine } from './reimint';
import { ConsensusType, ConsensusEngine, ConsensusEngineConstructor, ConsensusEngineOptions } from './types';

export * from './pendingBlock';
export * from './types';

const engines = new Map<ConsensusType, ConsensusEngineConstructor>([
  [ConsensusType.Clique, CliqueConsensusEngine],
  [ConsensusType.Reimint, ReimintConsensusEngine]
]);

export function createEnginesByConsensusTypes(types: ConsensusType[], options: ConsensusEngineOptions) {
  return new Map<ConsensusType, ConsensusEngine>(types.map((type) => [type, new (engines.get(type)!)(options)]));
}
