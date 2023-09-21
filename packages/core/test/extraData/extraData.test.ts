import crypto from 'crypto';
import { expect } from 'chai';
import { Address, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { SecretKey, initBls, importBls } from '@rei-network/bls';
import { BlockHeader } from '@rei-network/structure';
import { DuplicateVoteEvidence, Vote, VoteType, VoteSet, Reimint, ExtraData, SignatureType, Proposal, ActiveValidatorSet, ActiveValidator } from '../../src/reimint';
import { MockAccountManager } from '../util';
import { isEnableHardfork4 } from '../../src';

describe('extraData', () => {
  let accMngr: MockAccountManager;
  const activeValidators: ActiveValidator[] = [];
  const accountAmount = 21;

  before(async () => {
    await initBls();
    const blsSecretFactory = importBls().SecretKey.fromKeygen;
    const addressFactory = () => Address.fromPrivateKey(crypto.randomBytes(32));
    const accountInfos: [string, Address, Buffer, SecretKey][] = [];

    for (let i = 0; i < accountAmount; i++) {
      const blsInfo = blsSecretFactory();
      const addressInfo = addressFactory();
      accountInfos.push(['validator' + i, addressInfo, Buffer.from(blsInfo.toPublicKey().toBytes()), blsInfo]);
      activeValidators.push({
        validator: addressInfo,
        votingPower: new BN(100 * (Math.random() * 100)),
        priority: new BN(0),
        blsPublicKey: Buffer.from(blsInfo.toPublicKey().toBytes())
      });
    }
    accMngr = new MockAccountManager(accountInfos);
  });

  it('should raw and fromSerializedVote successfully for bls signature', async () => {
    const height = new BN(2);
    const common = new Common({ chain: 'rei-devnet', hardfork: 'rei-dao' });
    const validatorSet = new ActiveValidatorSet(activeValidators);
    const evidence = getEvidence(accMngr, common);
    const { voteSet, proposal } = getVoteSetAndProposal(accMngr, height, common, evidence, validatorSet);
    const cliVersion = undefined;
    const extraData = new ExtraData(0, 0, 0, [evidence], proposal, SignatureType.BLS, cliVersion, voteSet);
    const serialized = extraData.serialize();
    const finalHeader = BlockHeader.fromHeaderData({ extraData: Buffer.concat([Buffer.alloc(32), serialized]), number: height }, { common: common });
    const extraData2 = ExtraData.fromBlockHeader(finalHeader, { valSet: validatorSet });

    expect(extraData2.voteSet?.aggregatedSignature?.equals(extraData.voteSet!.aggregatedSignature!), 'blsAggregateSignature should be equal').to.be.true;
    expect(extraData2.round === extraData.round, 'round should be equal').to.be.true;
    expect(extraData2.proposal?.hash.equals(extraData.proposal?.hash!), 'proposal should be equal').to.be.true;
    expect(extraData2.proposal?.height.eq(extraData.proposal?.height!), 'proposal should be equal').to.be.true;
    expect(extraData2.proposal?.round === extraData.proposal?.round, 'proposal should be equal').to.be.true;
    expect(extraData2.proposal?.POLRound === extraData.proposal?.POLRound, 'proposal should be equal').to.be.true;
    expect(extraData2.proposal?.type === extraData.proposal?.type, 'proposal should be equal').to.be.true;
    expect(extraData2.proposal?.signature!.equals(extraData.proposal?.signature!), 'proposal should be equal').to.be.true;
    extraData.evidence.forEach((evidence, index) => {
      expect(evidence.hash().equals(extraData2.evidence[index].hash()), 'evidence should be equal').to.be.true;
    });
    extraData2.validateBasic();
  });

  it('should extraData encode and decode successful when before hardfork 4', async () => {
    //todo before hardfork 4
    const common = new Common({ chain: 'rei-devnet', hardfork: 'rei-dao' });
    const enable = isEnableHardfork4(common);
    expect(enable).to.be.false;
  });

  it('should extraData encode and decode successful when after hardfork 4', async () => {
    //todo after hardfork 4
    const common = new Common({ chain: 'rei-devnet', hardfork: 'devnet-hf-4' });
    const enable = isEnableHardfork4(common);
    expect(enable).to.be.true;
  });
});

function getEvidence(accMngr: MockAccountManager, common: Common) {
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
  voteA.signature = Buffer.from(accMngr.n2b('validator1').sign(voteA.getMessageToSign()).toBytes());
  voteB.signature = Buffer.from(accMngr.n2b('validator1').sign(voteB.getMessageToSign()).toBytes());
  const vote1 = voteA.hash.compare(voteB.hash) > 0 ? voteB : voteA;
  const vote2 = voteA.hash.compare(voteB.hash) > 0 ? voteA : voteB;
  return new DuplicateVoteEvidence(vote1, vote2);
}

function getVoteSetAndProposal(accMngr: MockAccountManager, height: BN, common: Common, evidence: DuplicateVoteEvidence, validatorSet: ActiveValidatorSet) {
  const votes: Vote[] = [];
  const blockHeader = BlockHeader.fromHeaderData({ extraData: Buffer.alloc(32), number: height }, { common: common });
  const headerRawHash = Reimint.calcBlockHeaderRawHash(blockHeader, [evidence]);
  const voteSet = new VoteSet(common.chainId(), height, 0, VoteType.Precommit, validatorSet, SignatureType.BLS);
  for (let i = 0; i < validatorSet.length; i++) {
    const validator = validatorSet.getValidatorByIndex(i);
    const vote = new Vote(
      {
        height: height,
        round: 0,
        chainId: common.chainId(),
        type: VoteType.Precommit,
        hash: headerRawHash,
        index: i,
        validator
      },
      SignatureType.BLS
    );
    vote.signature = Buffer.from(accMngr.a2b(validator).sign(vote.getMessageToSign()).toBytes());
    votes.push(vote);
  }
  votes.forEach((vote) => voteSet.addVote(vote));
  const proposal = new Proposal(
    {
      type: VoteType.Proposal,
      height: height,
      round: 0,
      POLRound: 0,
      hash: headerRawHash,
      proposer: validatorSet.proposer
    },
    SignatureType.BLS
  );
  proposal.signature = Buffer.from(accMngr.a2b(validatorSet.proposer).sign(proposal.getMessageToSign()).toBytes());
  return { voteSet, proposal };
}
