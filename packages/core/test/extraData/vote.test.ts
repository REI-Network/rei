import crypto from 'crypto';
import { assert, expect } from 'chai';
import { Address, BN, ecsign, intToBuffer } from 'ethereumjs-util';
import { DuplicateVoteEvidence } from '../../src/consensus/reimint/evpool';
import { Vote, VoteType, VoteVersion } from '../../src/consensus/reimint/vote';
import { MockAccountManager } from '../util';
import { Bls, SecretKey } from '@rei-network/bls';

describe('BlsVote', () => {
  let bls: Bls;
  let accMngr: MockAccountManager;
  const secretKeys: SecretKey[] = [];
  before(async () => {
    bls = (await import('@chainsafe/bls')).default;
    for (let i = 0; i < 6; i++) {
      secretKeys.push(bls.SecretKey.fromKeygen());
    }
    accMngr = new MockAccountManager([
      ['validator1', Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'), Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'), secretKeys[0]],
      ['validator2', Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'), Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex'), secretKeys[1]],
      ['validator3', Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'), Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'), secretKeys[2]],
      ['validator4', Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'), Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex'), secretKeys[3]],
      ['validator5', Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'), Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'), secretKeys[4]],
      ['validator6', Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'), Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex'), secretKeys[5]]
    ]);
  });

  it('should raw and fromSerializedVote successfully for blsSingature', () => {
    const vote0 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      VoteVersion.blsSignature
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
    expect(vote0.signature.compare(vote1.signature!)).to.be.equal(0);
    expect(vote0.blsSignature.compare(vote1.blsSignature!)).to.be.equal(0);
    expect(vote0.version).to.be.equal(vote1.version);

    const address = vote0.validator().toString();
    expect(address).to.be.equal(accMngr.n2a('validator1').toString());
  });
});
