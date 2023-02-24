import crypto from 'crypto';
import { assert, expect } from 'chai';
import { Address, BN } from 'ethereumjs-util';
import { DuplicateVoteEvidence } from '../../src/consensus/reimint/evpool';
import { Vote, VoteType, VoteVersion } from '../../src/consensus/reimint/vote';
import { MockAccountManager } from '../util';

const accMngr = new MockAccountManager([
  ['foo', Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'), Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex')],
  ['bar', Address.fromString('0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'), Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')]
]);

const version = VoteVersion.ecdsaSignature;
class MockValidatorSet {
  private validators: Address[];

  constructor(validators: Address[]) {
    this.validators = validators;
  }

  getValidatorByIndex(index: number) {
    return this.validators[index] ?? Address.zero();
  }
}

function shouldFailed(fn: () => void, message?: string) {
  try {
    fn();
    assert.fail();
  } catch (err: any) {
    if (message) {
      expect(err.message, 'error message should be equal').be.equal(message);
    }
  }
}

describe('DuplicateVoteEvidence', () => {
  it('should failed(unsigned)', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );

    shouldFailed(() => {
      DuplicateVoteEvidence.fromVotes(vote1, vote2);
    }, 'invalid votes(unsigned)');
  });

  it('should failed(vote content)', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 1,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 2,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote2.sign(accMngr.n2p('foo'));

    shouldFailed(() => {
      DuplicateVoteEvidence.fromVotes(vote1, vote2);
    }, 'invalid votes(vote content)');
  });

  it('should failed(vote content)', () => {
    const hash = crypto.randomBytes(32);
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: hash,
        index: 0
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: hash,
        index: 0
      },
      version
    );
    vote2.sign(accMngr.n2p('foo'));

    shouldFailed(() => {
      DuplicateVoteEvidence.fromVotes(vote1, vote2);
    }, 'invalid votes(same hash)');
  });

  it('should failed(vote content)', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote2.sign(accMngr.n2p('bar'));

    shouldFailed(() => {
      DuplicateVoteEvidence.fromVotes(vote1, vote2);
    }, 'invalid votes(unequal validator)');
  });

  it('should failed(sort)', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote2.sign(accMngr.n2p('foo'));

    shouldFailed(() => {
      const [voteA, voteB] = DuplicateVoteEvidence.sortVote(vote1, vote2);
      new DuplicateVoteEvidence(voteB, voteA);
    }, 'invalid votes(sort)');
  });

  it('should failed(validator index)', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 1
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 1
      },
      version
    );
    vote2.sign(accMngr.n2p('foo'));

    shouldFailed(() => {
      const ev = DuplicateVoteEvidence.fromVotes(vote2, vote1);
      ev.verify(new MockValidatorSet([accMngr.n2a('foo')]) as any);
    }, 'invalid votes(validator index)');
  });

  it('should verify successfully', () => {
    const vote1 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote1.sign(accMngr.n2p('foo'));

    const vote2 = new Vote(
      {
        height: new BN(1),
        round: 0,
        chainId: 100,
        type: VoteType.Precommit,
        hash: crypto.randomBytes(32),
        index: 0
      },
      version
    );
    vote2.sign(accMngr.n2p('foo'));
    const ev = DuplicateVoteEvidence.fromVotes(vote2, vote1);
    ev.verify(new MockValidatorSet([accMngr.n2a('foo')]) as any);
  });
});
