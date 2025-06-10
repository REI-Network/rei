import crypto from 'crypto';
import { expect } from 'chai';
import { Address, BN } from 'ethereumjs-util';
import {
  Vote,
  VoteType,
  SignatureType,
  VoteSet,
  ActiveValidatorSet,
  ActiveValidator
} from '../../src/reimint';
import { MockAccountManager } from '../util';
import { Bls, SecretKey, initBls, importBls } from '@rei-network/bls';

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
      [
        'validator1',
        Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'),
        Buffer.from(
          'd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0',
          'hex'
        ),
        secretKeys[0]
      ],
      [
        'validator2',
        Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'),
        Buffer.from(
          'db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c',
          'hex'
        ),
        secretKeys[1]
      ],
      [
        'validator3',
        Address.fromString('0x7a098e50c6861eefbe7ea9248751cf1a54ec123a'),
        Buffer.from(
          '91825a14889a525493807648e90173394257d68f1ccbe9a628f900e0f92c9457',
          'hex'
        ),
        secretKeys[2]
      ],
      [
        'validator4',
        Address.fromString('0x47a8b126ceab7f6ceb646f61dd83b1ad573720ef'),
        Buffer.from(
          '302c411e1365a7bf4767ccdec0be9dd1efe8f9130e9ee4fd3b70edadc632ec3f',
          'hex'
        ),
        secretKeys[3]
      ],
      [
        'validator5',
        Address.fromString('0xa809255a8fd1af041782842f6392d3e14147066b'),
        Buffer.from(
          '1d6589671cfe1db8085d1cefd5e1d1be2641f8a9e1df031c25436cfb30aa527c',
          'hex'
        ),
        secretKeys[4]
      ],
      [
        'validator6',
        Address.fromString('0x67700f74d81c74b70c256886971a9400a1de1f2c'),
        Buffer.from(
          '05ddfc4e38b133e228f74bc86f899f480ba401ab605aa51686617df71d208c2b',
          'hex'
        ),
        secretKeys[5]
      ]
    ]);
  });

  it('should raw and fromSerializedVote successfully for bls signature', () => {
    const vote0 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0,
        validator: accMngr.n2a('validator1')
      },
      SignatureType.BLS
    );
    vote0.signature = Buffer.from(
      accMngr.n2b('validator1').sign(vote0.getMessageToSign()).toBytes()
    );

    const serializedVote = vote0.serialize();

    const vote1 = Vote.fromSerializedVote(serializedVote);
    expect(vote0.chainId).to.be.equal(vote1.chainId);
    expect(vote0.height.eq(vote1.height)).to.be.true;
    expect(vote0.round).to.be.equal(vote1.round);
    expect(vote0.type).to.be.equal(vote1.type);
    expect(vote0.hash.compare(vote1.hash)).to.be.equal(0);
    expect(vote0.index).to.be.equal(vote1.index);
    expect(vote0.signatureType).to.be.equal(vote1.signatureType);
    expect(vote0.signature.compare(vote1.signature!)).to.be.equal(0);
    expect(vote0.getValidator().equals(vote1.getValidator())).be.true;
  });

  it('should get vote set aggregated signature successfully for bls singature', async () => {
    const voteHash = crypto.randomBytes(32);
    const activeValidators: ActiveValidator[] = [];
    const votes: Vote[] = [];
    Array.from(accMngr.nameToAddress.values()).forEach((address, index) => {
      activeValidators.push({
        validator: address,
        votingPower: new BN(100 * (index + 1)),
        priority: new BN(0),
        blsPublicKey: Buffer.from(accMngr.a2b(address).toPublicKey().toBytes())
      });
      votes.push(
        new Vote(
          {
            height: new BN(1),
            round: 0,
            chainId: 100,
            type: VoteType.Precommit,
            hash: voteHash,
            index: index,
            validator: address
          },
          SignatureType.BLS
        )
      );
    });
    const valSet = new ActiveValidatorSet(activeValidators);
    const voteSet = new VoteSet(
      100,
      new BN(1),
      0,
      VoteType.Precommit,
      valSet,
      SignatureType.BLS
    );
    votes.forEach((vote) => {
      vote.signature = Buffer.from(
        accMngr
          .n2b(accMngr.addressToName.get(vote.getValidator())!)
          .sign(vote.getMessageToSign())
          .toBytes()
      );
      voteSet.addVote(vote);
    });
    const aggregatedSignature = voteSet.getAggregatedSignature();
    const pubKeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    expect(
      bls.verifyAggregate(
        pubKeys,
        votes[0].getMessageToSign(),
        aggregatedSignature
      )
    ).to.be.true;
  });
});
