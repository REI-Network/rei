import crypto from 'crypto';
import { expect } from 'chai';
import { Address, BN, ecsign, intToBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Bls, SecretKey, initBls, importBls } from '@rei-network/bls';
import { BlockHeader } from '@rei-network/structure';
import { Vote, VoteType, VoteSet, Reimint, ExtraData, SignType, Proposal } from '../../src/consensus/reimint';
import { ActiveValidatorSet, ActiveValidator, copyActiveValidator } from '../../src/consensus/reimint/validatorSet';
import { DuplicateVoteEvidence } from '../../src/consensus';
import { MockAccountManager } from '../util';

type MockActiveValidator = {
  ActiveValidator: ActiveValidator;
  blsPublicKey: Buffer;
};

class MockActiveValidatorSet extends ActiveValidatorSet {
  blsPublicKeys: MockActiveValidator[];

  constructor(validators: ActiveValidator[], blsPublicKeys: Buffer[], proposer?: Address) {
    super(validators, proposer);
    this.blsPublicKeys = validators.map((v, i) => {
      return {
        ActiveValidator: v,
        blsPublicKey: blsPublicKeys[i]
      };
    });
  }

  getBlsPublickeyByIndex(index: number) {
    return this.blsPublicKeys[index].blsPublicKey;
  }

  copy() {
    return new MockActiveValidatorSet(
      this.activeValidators().map(copyActiveValidator),
      this.blsPublicKeys.map((v) => v.blsPublicKey),
      this.proposer
    );
  }
}

describe('extraDataBls', () => {
  let bls: Bls;
  let accMngr: MockAccountManager;
  let common: Common;
  const secretKeys: SecretKey[] = [];
  const height = new BN(2);
  before(async () => {
    common = new Common({ chain: 'rei-devnet', hardfork: 'rei-dao' });
    await initBls();
    bls = importBls();
    for (let i = 0; i < 6; i++) {
      secretKeys.push(bls.SecretKey.fromKeygen());
    }
    accMngr = new MockAccountManager([
      ['validator1', Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'), Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'), secretKeys[0]],
      ['validator2', Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'), Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex'), secretKeys[1]],
      ['validator3', Address.fromString('0x7a098e50c6861eefbe7ea9248751cf1a54ec123a'), Buffer.from('91825a14889a525493807648e90173394257d68f1ccbe9a628f900e0f92c9457', 'hex'), secretKeys[2]],
      ['validator4', Address.fromString('0x47a8b126ceab7f6ceb646f61dd83b1ad573720ef'), Buffer.from('302c411e1365a7bf4767ccdec0be9dd1efe8f9130e9ee4fd3b70edadc632ec3f', 'hex'), secretKeys[3]],
      ['validator5', Address.fromString('0xa809255a8fd1af041782842f6392d3e14147066b'), Buffer.from('1d6589671cfe1db8085d1cefd5e1d1be2641f8a9e1df031c25436cfb30aa527c', 'hex'), secretKeys[4]],
      ['validator6', Address.fromString('0x67700f74d81c74b70c256886971a9400a1de1f2c'), Buffer.from('05ddfc4e38b133e228f74bc86f899f480ba401ab605aa51686617df71d208c2b', 'hex'), secretKeys[5]]
    ]);
  });

  it('should raw and fromSerializedVote successfully for blsSignature', async () => {
    const blockHeader = BlockHeader.fromHeaderData({ extraData: Buffer.alloc(32), number: height }, { common: common });
    const voteA = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: common.chainId(),
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      SignType.blsSignature
    );
    const voteB = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: common.chainId(),
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      SignType.blsSignature
    );
    const evidenceSignatureA = ecsign(voteA.getMessageToSign(), accMngr.nameToPrivKey.get('validator1')!);
    const evidenceSignatureB = ecsign(voteB.getMessageToSign(), accMngr.nameToPrivKey.get('validator1')!);
    voteA.signature = Buffer.concat([evidenceSignatureA.r, evidenceSignatureA.s, intToBuffer(evidenceSignatureA.v - 27)]);
    voteB.signature = Buffer.concat([evidenceSignatureB.r, evidenceSignatureB.s, intToBuffer(evidenceSignatureB.v - 27)]);
    voteA.blsSignature = Buffer.from(accMngr.n2b(accMngr.addressToName.get(voteA.validator())!).sign(voteA.getMessageToBlsSign()).toBytes());
    voteB.blsSignature = Buffer.from(accMngr.n2b(accMngr.addressToName.get(voteB.validator())!).sign(voteB.getMessageToBlsSign()).toBytes());
    const vote1 = voteA.hash.compare(voteB.hash) > 0 ? voteB : voteA;
    const vote2 = voteA.hash.compare(voteB.hash) > 0 ? voteA : voteB;
    const evidence = new DuplicateVoteEvidence(vote1, vote2);
    const headerRawHash = Reimint.calcBlockHeaderRawHash(blockHeader, [evidence]);

    const votes: Vote[] = [];
    const activeValidators: ActiveValidator[] = [];
    Array.from(accMngr.nameToAddress.values()).forEach((address, index) => {
      activeValidators.push({
        validator: address,
        votingPower: new BN(100 * (index + 1)),
        priority: new BN(0)
      });
      const vote = new Vote(
        {
          height: height,
          round: 0,
          chainId: common.chainId(),
          type: VoteType.Precommit,
          hash: headerRawHash,
          index: index
        },
        SignType.blsSignature
      );
      const privateKey = Array.from(accMngr.nameToPrivKey.values())[index];
      const signature = ecsign(vote.getMessageToSign(), privateKey);
      vote.signature = Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
      vote.blsSignature = Buffer.from(accMngr.n2b(accMngr.addressToName.get(vote.validator())!).sign(vote.getMessageToBlsSign()).toBytes());
      votes.push(vote);
    });
    const valSet = new MockActiveValidatorSet(
      activeValidators,
      secretKeys.map((sk) => Buffer.from(sk.toPublicKey().toBytes()))
    );

    const voteSet = new VoteSet(common.chainId(), height, 0, VoteType.Precommit, valSet, SignType.blsSignature);

    votes.forEach((vote) => {
      voteSet.addVote(vote);
    });
    const proposal = new Proposal({
      type: VoteType.Proposal,
      height: height,
      round: 0,
      POLRound: 0,
      hash: headerRawHash
    });
    const proposalSignature = ecsign(proposal.getMessageToSign(), accMngr.n2p('validator1')!);
    proposal.signature = Buffer.concat([proposalSignature.r, proposalSignature.s, intToBuffer(proposalSignature.v - 27)]);
    const extraData = new ExtraData(0, 0, 0, [evidence], proposal, SignType.blsSignature, voteSet);
    const serialized = extraData.serialize();
    const finalHeader = BlockHeader.fromHeaderData({ extraData: Buffer.concat([blockHeader.extraData as Buffer, serialized]), number: height }, { common: common });
    const extraData2 = ExtraData.fromBlockHeader(finalHeader, { valSet: valSet });

    expect(extraData2.blsAggregateSignature?.equals(extraData.blsAggregateSignature!), 'blsAggregateSignature should be equal').to.be.true;
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
});