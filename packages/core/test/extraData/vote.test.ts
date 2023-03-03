import crypto from 'crypto';
import { expect } from 'chai';
import { Address, BN, ecsign, intToBuffer } from 'ethereumjs-util';
import { Vote, VoteType, SignType, VoteSet } from '../../src/consensus/reimint/vote';
import { MockAccountManager } from '../util';
import { Bls, SecretKey, initBls, importBls } from '@rei-network/bls';
import { ActiveValidatorSet, ActiveValidator } from '../../src/consensus/reimint/validatorSet';

describe('BlsVote', () => {
  let bls: Bls;
  let accMngr: MockAccountManager;
  const secretKeys: SecretKey[] = [];
  before(async () => {
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

  it('should raw and fromSerializedVote successfully for blsSignature', () => {
    const vote0 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      SignType.blsSignature
    );
    const { r, s, v } = ecsign(vote0.getMessageToSign(), accMngr.n2p('validator1'));
    const signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
    const blsSignature = accMngr.n2b('validator1').sign(vote0.getMessageToBlsSign());
    vote0.signature = signature;
    vote0.blsSignature = Buffer.from(blsSignature.toBytes());

    const serializedVote = vote0.serialize();

    const vote1 = Vote.fromSerializedVote(serializedVote);
    expect(vote0.chainId).to.be.equal(vote1.chainId);
    expect(vote0.height.eq(vote1.height)).to.be.true;
    expect(vote0.round).to.be.equal(vote1.round);
    expect(vote0.type).to.be.equal(vote1.type);
    expect(vote0.hash.compare(vote1.hash)).to.be.equal(0);
    expect(vote0.index).to.be.equal(vote1.index);
    expect(vote0.version).to.be.equal(vote1.version);
    expect(vote0.signature.compare(vote1.signature!)).to.be.equal(0);
    expect(vote0.blsSignature.compare(vote1.blsSignature!)).to.be.equal(0);
    expect(vote0.validator().equals(vote1.validator())).be.true;
  });

  it('should get votset aggregate signature successfully for blsSingature', async () => {
    const voteHash = crypto.randomBytes(32);
    const activeValidators: ActiveValidator[] = [];
    const votes: Vote[] = [];
    Array.from(accMngr.nameToAddress.values()).forEach((address, index) => {
      activeValidators.push({
        validator: address,
        votingPower: new BN(100 * (index + 1)),
        priority: new BN(0)
      });
      votes.push(
        new Vote(
          {
            height: new BN(1),
            round: 0,
            chainId: 100,
            type: VoteType.Precommit,
            hash: voteHash,
            index: index
          },
          SignType.blsSignature
        )
      );
    });
    const valSet = new ActiveValidatorSet(activeValidators);
    const voteSet = new VoteSet(100, new BN(1), 0, VoteType.Precommit, valSet, SignType.blsSignature);
    votes.forEach((vote, index) => {
      const privateKey = Array.from(accMngr.nameToPrivKey.values())[index];
      const signature = ecsign(vote.getMessageToSign(), privateKey);
      vote.signature = Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
      vote.blsSignature = Buffer.from(accMngr.n2b(accMngr.addressToName.get(vote.validator())!).sign(vote.getMessageToBlsSign()).toBytes());
      voteSet.addVote(vote);
    });
    const aggregateSignature = voteSet.getAggregateSignature();
    const pubKeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    expect(bls.verifyAggregate(pubKeys, votes[0].getMessageToBlsSign(), aggregateSignature!)).to.be.true;
  });
});
