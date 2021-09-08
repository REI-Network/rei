import { expect, assert } from 'chai';
import { Address, BN, BNLike, MAX_INTEGER } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { FunctionalMap } from '@gxchain2/utils';
import { ValidatorSet, ValidatorChanges } from '../../src/staking';

function createCommon(num: BNLike) {
  return Common.createCommonByBlockNumber(num, 'gxc2-testnet');
}

function createValidatorSet(validators: { [name: string]: number | BN }, fill = false) {
  const common = createCommon(1);
  const num = common.hardforkBlockBN('testnet-hf1')!;
  common.setHardforkByBlockNumber(num);
  const vs = ValidatorSet.createGenesisValidatorSet(common, fill);
  const changes = new ValidatorChanges(vs);
  for (const [name, votingPower] of Object.entries(validators)) {
    changes.index(n2a(name), typeof votingPower === 'number' ? new BN(votingPower) : votingPower);
  }
  vs.mergeChanges(changes);
  vs.incrementProposerPriority(1);
  return vs;
}

const nameToAddress = {
  foo: Address.fromString('0x1000000000000000000000000000000000000000'),
  bar: Address.fromString('0x2000000000000000000000000000000000000000'),
  baz: Address.fromString('0x3000000000000000000000000000000000000000')
};

function n2a(name: string) {
  return nameToAddress[name] as Address;
}

const addressToName = new FunctionalMap<Address, string>((a: Address, b: Address) => a.buf.compare(b.buf));
addressToName.set(Address.fromString('0x1000000000000000000000000000000000000000'), 'foo');
addressToName.set(Address.fromString('0x2000000000000000000000000000000000000000'), 'bar');
addressToName.set(Address.fromString('0x3000000000000000000000000000000000000000'), 'baz');

function a2n(address: Address) {
  return addressToName.get(address)!;
}

describe('ValidatorSet', () => {
  it('should fill genesis validators', () => {
    const vs = createValidatorSet({}, true) as any;
    const genesisValidators = vs.common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
    for (let i = 0; i < genesisValidators.length; i++) {
      expect(vs.active[i].validator.equals(genesisValidators[i]), 'genesis validator address should be equal');
    }
  });

  it('should increment proposer priority succeed', () => {
    const vs = createValidatorSet({
      foo: 1000,
      bar: 300,
      baz: 330
    });
    const proposers: string[] = [];
    for (let i = 0; i < 99; i++) {
      const proposer = vs.proposer();
      proposers.push(a2n(proposer));
      vs.subtractProposerPriority(proposer);
      vs.incrementProposerPriority(1);
    }
    expect(proposers.join(' '), 'sequence of proposers should be equal').be.equal('foo baz foo bar foo foo baz foo bar foo foo baz foo foo bar foo baz foo foo bar foo foo baz foo bar foo foo baz foo bar foo foo baz foo foo bar foo baz foo foo bar foo baz foo foo bar foo baz foo foo bar foo baz foo foo foo baz bar foo foo foo baz foo bar foo foo baz foo bar foo foo baz foo bar foo foo baz foo bar foo foo baz foo foo bar foo baz foo foo bar foo baz foo foo bar foo baz foo foo');
  });

  it('should sort by address when voting power is equal', () => {
    const vs = createValidatorSet({
      foo: 1000,
      bar: 1000,
      baz: 1000
    });
    const proposers: string[] = [];
    for (let i = 0; i < 3 * 5; i++) {
      const proposer = vs.proposer();
      proposers.push(a2n(proposer));
      vs.subtractProposerPriority(proposer);
      vs.incrementProposerPriority(1);
    }
    expect(proposers.join(' ') + ' ', 'sequence of proposers should be equal').be.equal('foo bar baz '.repeat(5));
  });

  it('should be first proposer but not enough to propose twice in a row', () => {
    const vs = createValidatorSet({
      foo: 100,
      bar: 100,
      baz: 400
    });
    let proposer = vs.proposer();
    vs.subtractProposerPriority(proposer);
    expect(proposer.equals(n2a('baz')), 'should be first proposer').be.true;
    vs.incrementProposerPriority(1);
    proposer = vs.proposer();
    vs.subtractProposerPriority(proposer);
    expect(proposer.equals(n2a('baz')), "shouldn't be proposer twice in a row").be.false;
  });

  it('should be proposer twice in a row', () => {
    const vs = createValidatorSet({
      foo: 100,
      bar: 100,
      baz: 401
    });
    let proposer = vs.proposer();
    vs.subtractProposerPriority(proposer);
    expect(proposer.equals(n2a('baz')), 'should be first proposer').be.true;
    vs.incrementProposerPriority(1);
    proposer = vs.proposer();
    vs.subtractProposerPriority(proposer);
    expect(proposer.equals(n2a('baz')), 'should be second proposer').be.true;
    proposer = vs.proposer();
    vs.subtractProposerPriority(proposer);
    expect(proposer.equals(n2a('baz')), "shouldn't be proposer again").be.false;
  });

  it('each validator should be the proposer a proportional number of times', () => {
    const vs = createValidatorSet({
      foo: 4,
      bar: 5,
      baz: 3
    });
    const N = 1;
    const times = new Map<string, number>();
    for (let i = 0; i < 120 * N; i++) {
      const proposer = vs.proposer();
      const name = a2n(proposer);
      vs.subtractProposerPriority(proposer);
      times.set(name, (times.get(name) ?? 0) + 1);
      vs.incrementProposerPriority(1);
    }
    expect(times.get('foo'), 'foo proposer times should be equal').be.equal(40 * N);
    expect(times.get('bar'), 'bar proposer times should be equal').be.equal(50 * N);
    expect(times.get('baz'), 'baz proposer times should be equal').be.equal(30 * N);
  });

  it('should throw an error when the number overflows', () => {
    try {
      const vs = createValidatorSet({
        foo: MAX_INTEGER
      });
      assert.fail('should throw an error when the number overflows');
    } catch (err) {}
  });
});
