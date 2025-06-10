import crypto from 'crypto';
import { expect } from 'chai';
import { Address, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { SecretKey, initBls, importBls } from '@rei-network/bls';
import { BlockHeader } from '@rei-network/structure';
import {
  DuplicateVoteEvidence,
  Vote,
  VoteType,
  VoteSet,
  Reimint,
  ExtraData,
  SignatureType,
  Proposal,
  ActiveValidatorSet,
  ActiveValidator
} from '../../src/reimint';
import { MockAccountManager } from '../util';

describe('extraDataBls', () => {
  let accMngr: MockAccountManager;
  const common = new Common({ chain: 'rei-devnet', hardfork: 'rei-dao' });
  const secretKeys: SecretKey[] = [];
  const height = new BN(2);

  before(async () => {
    await initBls();
    secretKeys.push(importBls().SecretKey.fromKeygen());
    accMngr = new MockAccountManager([
      [
        'validator1',
        Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'),
        Buffer.from(
          'd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0',
          'hex'
        ),
        secretKeys[0]
      ]
    ]);
  });

  it('should raw and fromSerializedVote successfully for bls signature', async () => {
    const blockHeader = BlockHeader.fromHeaderData(
      { extraData: Buffer.alloc(32), number: height },
      { common: common }
    );
    const voteA = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: common.chainId(),
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0,
        validator: accMngr.n2a('validator1')
      },
      SignatureType.BLS
    );
    const voteB = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: common.chainId(),
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0,
        validator: accMngr.n2a('validator1')
      },
      SignatureType.BLS
    );
    voteA.signature = Buffer.from(
      accMngr.n2b('validator1').sign(voteA.getMessageToSign()).toBytes()
    );
    voteB.signature = Buffer.from(
      accMngr.n2b('validator1').sign(voteB.getMessageToSign()).toBytes()
    );
    const vote1 = voteA.hash.compare(voteB.hash) > 0 ? voteB : voteA;
    const vote2 = voteA.hash.compare(voteB.hash) > 0 ? voteA : voteB;
    const evidence = new DuplicateVoteEvidence(vote1, vote2);
    const headerRawHash = Reimint.calcBlockHeaderRawHash(blockHeader, [
      evidence
    ]);

    const votes: Vote[] = [];
    const activeValidators: ActiveValidator[] = [];
    Array.from(accMngr.nameToAddress.values()).forEach((address, index) => {
      activeValidators.push({
        validator: address,
        votingPower: new BN(100 * (index + 1)),
        priority: new BN(0),
        blsPublicKey: Buffer.from(accMngr.a2b(address).toPublicKey().toBytes())
      });
      const vote = new Vote(
        {
          height: height,
          round: 0,
          chainId: common.chainId(),
          type: VoteType.Precommit,
          hash: headerRawHash,
          index,
          validator: address
        },
        SignatureType.BLS
      );
      vote.signature = Buffer.from(
        accMngr.a2b(address).sign(vote.getMessageToSign()).toBytes()
      );
      votes.push(vote);
    });
    const valSet = new ActiveValidatorSet(activeValidators);
    const voteSet = new VoteSet(
      common.chainId(),
      height,
      0,
      VoteType.Precommit,
      valSet,
      SignatureType.BLS
    );
    votes.forEach((vote) => {
      voteSet.addVote(vote);
    });
    const proposal = new Proposal(
      {
        type: VoteType.Proposal,
        height: height,
        round: 0,
        POLRound: 0,
        hash: headerRawHash,
        proposer: accMngr.n2a('validator1')
      },
      SignatureType.BLS
    );
    proposal.signature = Buffer.from(
      accMngr.n2b('validator1').sign(proposal.getMessageToSign()).toBytes()
    );
    const extraData = new ExtraData(
      0,
      0,
      0,
      [evidence],
      proposal,
      SignatureType.BLS,
      voteSet
    );
    const serialized = extraData.serialize();
    const finalHeader = BlockHeader.fromHeaderData(
      {
        extraData: Buffer.concat([blockHeader.extraData as Buffer, serialized]),
        number: height
      },
      { common: common }
    );
    const extraData2 = ExtraData.fromBlockHeader(finalHeader, {
      valSet: valSet
    });

    expect(
      extraData2.voteSet?.aggregatedSignature?.equals(
        extraData.voteSet!.aggregatedSignature!
      ),
      'blsAggregateSignature should be equal'
    ).to.be.true;
    expect(extraData2.round === extraData.round, 'round should be equal').to.be
      .true;
    expect(
      extraData2.proposal?.hash.equals(extraData.proposal?.hash!),
      'proposal should be equal'
    ).to.be.true;
    expect(
      extraData2.proposal?.height.eq(extraData.proposal?.height!),
      'proposal should be equal'
    ).to.be.true;
    expect(
      extraData2.proposal?.round === extraData.proposal?.round,
      'proposal should be equal'
    ).to.be.true;
    expect(
      extraData2.proposal?.POLRound === extraData.proposal?.POLRound,
      'proposal should be equal'
    ).to.be.true;
    expect(
      extraData2.proposal?.type === extraData.proposal?.type,
      'proposal should be equal'
    ).to.be.true;
    expect(
      extraData2.proposal?.signature!.equals(extraData.proposal?.signature!),
      'proposal should be equal'
    ).to.be.true;
    extraData.evidence.forEach((evidence, index) => {
      expect(
        evidence.hash().equals(extraData2.evidence[index].hash()),
        'evidence should be equal'
      ).to.be.true;
    });
    extraData2.validateBasic();
  });
});
