import { expect, assert } from 'chai';
import { Address, BN, MAX_INTEGER } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { createBufferFunctionalMap } from '@gxchain2/utils';
import { ValidatorSet, ValidatorChanges, ValidatorInfo } from '../../src/staking';
import { MockAccountManager } from '../util';

const common = Common.createCommonByBlockNumber(1, 'gxc2-testnet');
const num = common.hardforkBlockBN('testnet-hf1')!;
common.setHardforkByBlockNumber(num);

const accMngr = new MockAccountManager([
  ['foo', Address.fromString('0x1000000000000000000000000000000000000000')],
  ['bar', Address.fromString('0x2000000000000000000000000000000000000000')],
  ['baz', Address.fromString('0x3000000000000000000000000000000000000000')],
  ['foo1', Address.fromString('0x4000000000000000000000000000000000000000')],
  ['bar1', Address.fromString('0x5000000000000000000000000000000000000000')],
  ['baz1', Address.fromString('0x6000000000000000000000000000000000000000')],
  ['foo2', Address.fromString('0x7000000000000000000000000000000000000000')],
  ['bar2', Address.fromString('0x8000000000000000000000000000000000000000')],
  ['baz2', Address.fromString('0x9000000000000000000000000000000000000000')],
  ['foo3', Address.fromString('0xa000000000000000000000000000000000000000')],
  ['bar3', Address.fromString('0xb000000000000000000000000000000000000000')],
  ['baz3', Address.fromString('0xc000000000000000000000000000000000000000')]
]);

function createValidatorSet(validators: { [name: string]: number | BN }) {
  const vs = new ValidatorSet(createBufferFunctionalMap<ValidatorInfo>(), [], common);
  const changes = new ValidatorChanges(vs);
  for (const [name, votingPower] of Object.entries(validators)) {
    changes.index(accMngr.n2a(name), typeof votingPower === 'number' ? new BN(votingPower) : votingPower);
  }
  vs.mergeChanges(changes);
  vs.incrementProposerPriority(1);
  return vs;
}

describe('ValidatorSet', () => {
  it('should fill genesis validators', () => {
    const vs = ValidatorSet.createGenesisValidatorSet(common);
    const genesisValidators = common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
    for (let i = 0; i < genesisValidators.length; i++) {
      expect((vs as any).active[i].validator.equals(genesisValidators[i]), 'genesis validator address should be equal');
    }
  });

  it('should choose correct validator', async () => {
    const vs = createValidatorSet({ foo: 50, bar: 50, baz: 50, foo1: 100, bar1: 100, baz1: 100, foo2: 100, bar2: 100, baz2: 100, foo3: 100, bar3: 100, baz3: 100 }) as any;
    const active = vs.active;
    expect(active[0].validator.toString()).equal(accMngr.n2a('foo1').toString());
    expect(active[1].validator.toString()).equal(accMngr.n2a('bar1').toString());
    expect(active[2].validator.toString()).equal(accMngr.n2a('baz1').toString());
    expect(active[3].validator.toString()).equal(accMngr.n2a('foo2').toString());
    expect(active[4].validator.toString()).equal(accMngr.n2a('bar2').toString());
    expect(active[5].validator.toString()).equal(accMngr.n2a('baz2').toString());
    expect(active[6].validator.toString()).equal(accMngr.n2a('foo3').toString());
    expect(active[7].validator.toString()).equal(accMngr.n2a('bar3').toString());
    expect(active[8].validator.toString()).equal(accMngr.n2a('baz3').toString());
  });

  it('should increment proposer priority succeed', () => {
    const vs = createValidatorSet({
      foo: 1000,
      bar: 300,
      baz: 330
    });
    const proposers: string[] = [];
    for (let i = 0; i < 99; i++) {
      const proposer = vs.proposer;
      proposers.push(accMngr.a2n(proposer));
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
      const proposer = vs.proposer;
      proposers.push(accMngr.a2n(proposer));
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
    let proposer = vs.proposer;
    expect(proposer.equals(accMngr.n2a('baz')), 'should be first proposer').be.true;
    vs.incrementProposerPriority(1);
    proposer = vs.proposer;
    expect(proposer.equals(accMngr.n2a('baz')), "shouldn't be proposer twice in a row").be.false;
  });

  it('should be proposer twice in a row', () => {
    const vs = createValidatorSet({
      foo: 100,
      bar: 100,
      baz: 401
    });
    let proposer = vs.proposer;
    expect(proposer.equals(accMngr.n2a('baz')), 'should be first proposer').be.true;

    vs.incrementProposerPriority(1);
    proposer = vs.proposer;
    expect(proposer.equals(accMngr.n2a('baz')), 'should be second proposer').be.true;

    vs.incrementProposerPriority(1);
    proposer = vs.proposer;
    expect(proposer.equals(accMngr.n2a('baz')), "shouldn't be proposer again").be.false;
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
      const proposer = vs.proposer;
      const name = accMngr.a2n(proposer);
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
