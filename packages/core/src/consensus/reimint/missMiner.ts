import { Block, BlockHeader } from '@rei-network/structure';
import { ExtraData } from './extraData';
import { ReimintConsensusEngine } from './engine';
import { FunctionalAddressMap, logger } from '@rei-network/utils';

export class MissMiner {
  readonly engine: ReimintConsensusEngine;

  constructor(engine: ReimintConsensusEngine) {
    this.engine = engine;
  }

  async getMissMiner(header: BlockHeader) {
    if (header.number.ltn(1)) {
      return [];
    }
    const missMinerMap = new FunctionalAddressMap<number>();
    const roundNumber = ExtraData.fromBlockHeader(header).round;
    logger.info('roundAndPOLRound is', roundNumber);
    if (roundNumber > 0) {
      const parentBlock = await this.engine.node.db.getBlock(header.parentHash);
      const activeSets = (await this.engine.validatorSets.getActiveValSet(parentBlock.header.stateRoot)).copy();
      for (let round = 0; round < roundNumber; round++) {
        const missminer = activeSets.proposer;
        missMinerMap.set(missminer, (missMinerMap.get(missminer) ?? 0) + 1);
        activeSets.incrementProposerPriority(1);
      }
    }
    return Array.from(missMinerMap.entries());
  }
}
