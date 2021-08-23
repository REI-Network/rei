import { expect } from 'chai';
import { Address, BN, BNLike } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { FunctionalMap } from '@gxchain2/utils';
import { ValidatorSet, ValidatorChanges } from '../../src/staking';

function createCommon(num: BNLike) {
  return Common.createCommonByBlockNumber(num, 'gxc2-testnet');
}

function createValidatorSet() {
  const common = createCommon(1);
  const num = common.hardforkBlockBN('testnet-hf1');
  common.setHardforkByBlockNumber(num);
  return ValidatorSet.createGenesisValidatorSet(common, false);
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
  it('should increment proposer priority succeed', () => {
    const vs = createValidatorSet();
    const changes = new ValidatorChanges(createValidatorSet());
    changes.index(n2a('foo'), new BN(1000));
    changes.index(n2a('bar'), new BN(300));
    changes.index(n2a('baz'), new BN(330));
    vs.mergeChanges(changes);
    vs.incrementProposerPriority(1);
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
    const vs = createValidatorSet();
    const changes = new ValidatorChanges(createValidatorSet());
    changes.index(n2a('foo'), new BN(1000));
    changes.index(n2a('bar'), new BN(1000));
    changes.index(n2a('baz'), new BN(1000));
    vs.mergeChanges(changes);
    vs.incrementProposerPriority(1);
    const proposers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const proposer = vs.proposer();
      proposers.push(a2n(proposer));
      vs.subtractProposerPriority(proposer);
      vs.incrementProposerPriority(1);
    }
    expect(proposers.join(' '), 'sequence of proposers should be equal').be.equal('baz bar foo');
  });
});
