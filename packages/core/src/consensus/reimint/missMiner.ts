import { Block, BlockHeader } from '@rei-network/structure';
import { ExtraData } from './extraData';
import { ReimintConsensusEngine } from './engine';
import { FunctionalAddressMap } from '@rei-network/utils';

export class MissMiner {
  readonly engine: ReimintConsensusEngine;

  constructor(engine: ReimintConsensusEngine) {
    this.engine = engine;
  }

  async getMissMiner(header: BlockHeader) {
    const missMinerMap = new FunctionalAddressMap<number>();
    const roundAndPOLRound = ExtraData.fromBlockHeader(header).POLRound;
    if (roundAndPOLRound > 0) {
      const parentBlock = await this.engine.node.db.getBlock(header.parentHash);
      const activeSets = await this.engine.validatorSets.getActiveValSet(parentBlock.header.stateRoot);
      for (let round = 0; round < roundAndPOLRound; round++) {
        const missminer = activeSets.proposer;
        let missRound = missMinerMap.get(missminer);
        missRound = missRound ? missRound + 1 : 1;
        missMinerMap.set(missminer, missRound);
      }
    }
    return missMinerMap;
  }
}
