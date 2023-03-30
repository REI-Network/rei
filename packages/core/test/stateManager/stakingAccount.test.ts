import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { StakingAccount } from '../../src/stateManager';
import { genRandomAccounts } from '../snap/util';

describe('stakingAccount', () => {
  const level = require('level-mem');
  const common = new Common({ chain: 'rei-devnet' });
  common.setHardforkByBlockNumber(0);
  const db = new Database(level(), common);
  const accounts: StakingAccount[] = [];
  const emptyAccount = new StakingAccount(new BN(1), new BN(1));

  before(async () => {
    const rootAndAccounts = await genRandomAccounts(db, 10, 10);
    accounts.push(...rootAndAccounts.accounts.map((a) => a.account));
    accounts.push(emptyAccount);
  });

  it('should slimRaw and fromSlimValuesArray correctly', () => {
    const accountRaw = accounts.map((a) => a.slimRaw());
    const accountsFromSlim = accountRaw.map((a) => StakingAccount.fromSlimValuesArray(a));
    for (let i = 0; i < accounts.length; i++) {
      expect(accounts[i].serialize().equals(accountsFromSlim[i].serialize()), 'account should be equal').to.be.true;
    }
  });

  it('should slimSerialize and fromRlpSerializedSlimAccount correctly', () => {
    const accountSlimSerialize = accounts.map((a) => a.slimSerialize());
    const accountsFromSlimSerialize = accountSlimSerialize.map((a) => StakingAccount.fromRlpSerializedSlimAccount(a));
    for (let i = 0; i < accounts.length; i++) {
      expect(accounts[i].serialize().equals(accountsFromSlimSerialize[i].serialize()), 'account should be equal').to.be.true;
    }
  });
});
