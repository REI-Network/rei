import { task } from 'hardhat/config';
import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

function toBN(data: number | string) {
  if (typeof data === 'string' && data.startsWith('0x')) {
    return new BN(data.substr(2), 'hex');
  }
  return new BN(data);
}

function toEther(value: string) {
  return toBN(value)
    .mul(new BN(10).pow(new BN(18)))
    .toString();
}

async function createWeb3Contract({ name, artifactName, address, deployments, web3, from, artifacts }: any) {
  const { get } = deployments;
  return new (web3 as Web3).eth.Contract((artifacts as Artifacts).require(artifactName ?? name).abi, address ?? (await get(name)).address, from ? { from } : undefined);
}

task('accounts', 'List accounts').setAction(async (taskArgs, { web3 }) => {
  console.log(await web3.eth.getAccounts());
});

task('transfer', 'Transfer value to target address')
  .addParam('from', 'from address')
  .addParam('to', 'to address')
  .addParam('value', 'transfer value')
  .setAction(async (taskArgs, { web3 }) => {
    await web3.eth.sendTransaction({
      from: taskArgs.from,
      to: taskArgs.to,
      value: taskArgs.value
    });
    console.log('Transfer succeed');
  });

task('lscfgaddr', 'List config addresses')
  .addOptionalParam('address', 'config contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    const config = await createWeb3Contract({ name: 'Config_test', deployments, web3, artifacts, address: taskArgs.address });
    console.log('Stake manager address:', await config.methods.stakeManager().call());
    console.log('Unstake pool address:', await config.methods.unstakePool().call());
    console.log('Validator reward pool address:', await config.methods.validatorRewardPool().call());
  });

task('stake', 'Stake for validator')
  .addParam('validator', 'validator address')
  .addOptionalParam('value', 'stake value')
  .addOptionalParam('address', 'stake manager contract address')
  .addFlag('ether', 'use ether as unit')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.value === undefined) {
      taskArgs.value = await stakeManager.methods.estimateMinStakeAmount(taskArgs.validator).call();
    } else if (taskArgs.ether) {
      taskArgs.value = toEther(taskArgs.value);
    }
    await stakeManager.methods.stake(taskArgs.validator, deployer).send({ value: taskArgs.value, gas: 12475531 });
    console.log('Stake succeed, value:', taskArgs.value);
  });

task('approve', 'Approve commission share')
  .addParam('validator', 'validator address')
  .addOptionalParam('spender', 'approve spender')
  .addOptionalParam('amount', 'approve amount')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const shareAddress = (await stakeManager.methods.validators(taskArgs.validator).call()).commissionShare;
    if (shareAddress === '0x0000000000000000000000000000000000000000') {
      console.log("validator doesn't exsit!");
      return;
    }
    const commissionShare = await createWeb3Contract({ name: 'CommissionShare', address: shareAddress, deployments, web3, artifacts, from: deployer });
    if (taskArgs.amount === undefined) {
      taskArgs.amount = MAX_INTEGER.toString();
    }
    await commissionShare.methods.approve(taskArgs.spender ?? stakeManager.options.address, taskArgs.amount).send();
    console.log('Approve succeed, amount:', taskArgs.amount);
  });

task('balance', 'Get balance')
  .addParam('addr', 'address')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, address: taskArgs.address });
    const shareAddress = (await stakeManager.methods.validators(taskArgs.validator).call()).commissionShare;
    if (shareAddress === '0x0000000000000000000000000000000000000000') {
      console.log("validator doesn't exsit!");
      return;
    }
    const commissionShare = await createWeb3Contract({ name: 'CommissionShare', address: shareAddress, deployments, web3, artifacts });
    console.log(await commissionShare.methods.name().call(), 'balance:', await commissionShare.methods.balanceOf(taskArgs.addr).call());
  });

task('sunstake', 'Start unstake')
  .addParam('validator', 'validator address')
  .addOptionalParam('receiver', 'receiver shares')
  .addOptionalParam('shares', 'unstake shares')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('repeat', 'repeat times')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.shares === undefined) {
      taskArgs.shares = await stakeManager.methods.estimateMinUnstakeShares(taskArgs.validator).call();
      if (taskArgs.shares === '0') {
        console.log("validator doesn't exsit!");
        return;
      }
    } else if (taskArgs.ether) {
      taskArgs.value = toEther(taskArgs.value);
    }
    const repeat = taskArgs.repeat ?? 1;
    for (let i = 0; i < repeat; i++) {
      const { events } = await stakeManager.methods.startUnstake(taskArgs.validator, taskArgs.receiver ?? deployer, taskArgs.shares).send({ gas: 304342 });
      let id;
      if (events) {
        for (const key in events) {
          if (key === 'StartUnstake') {
            id = toBN(events[key].raw.topics[1]).toNumber();
          }
        }
      }
      console.log('Start unstake succeed, shares:', taskArgs.shares, 'id:', id);
    }
  });

task('unstake', 'Do unstake')
  .addParam('id', 'unstake id')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const result = await stakeManager.methods.unstake(taskArgs.id).send();
    console.log('Unstake succeed, amount:', result.events.DoUnstake.returnValues.amount);
  });

task('scr', 'Set commission rate')
  .addParam('rate', 'commission rate(∈ [0, 100])')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: taskArgs.validator, address: taskArgs.address });
    await stakeManager.methods.setCommissionRate(taskArgs.rate).send();
    console.log('Set commission rate succeed');
  });

task('vu', 'Visit unstake info by id')
  .addParam('id', 'unstake id')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const u = await stakeManager.methods.unstakeQueue(taskArgs.id).call();
    console.log('\nvalidator:', u.validator, '\nto:', u.to, '\nunstakeShares:', u.unstakeShares, '\ntimestamp:', u.timestamp);
  });

task('vva', 'Visit validator information by address')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    console.log(await stakeManager.methods.validators(taskArgs.validator).call());
  });

task('vvi', 'Visit validator information by index')
  .addParam('index', 'validator index')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const address = await stakeManager.methods.indexedValidatorsByIndex(taskArgs.index).call();
    console.log(await stakeManager.methods.validators(address).call());
  });

task('vp', 'Visit validator voting power by address')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    console.log(await stakeManager.methods.getVotingPowerByAddress(taskArgs.validator).call());
  });

task('abr', 'assign block reward')
  .addParam('validator', 'validator address')
  .addParam('value', 'reward amount')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('address', 'router contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const router = await createWeb3Contract({ name: 'Router', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.ether) {
      taskArgs.value = toEther(taskArgs.value);
    }
    await router.methods.reward(taskArgs.validator).send({ value: taskArgs.value });
    console.log('Assign block reward succeed');
  });

task('deposit', 'deposit GXC for fee')
  .addParam('user', 'user address')
  .addParam('value', 'reward amount')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('address', 'fee contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const fee = await createWeb3Contract({ name: 'Fee', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.ether) {
      taskArgs.value = toEther(taskArgs.value);
    }
    await fee.methods.deposit(taskArgs.user).send({ value: taskArgs.value });
    console.log('Deposit succeed');
  });

task('withdraw', 'withdraw GXC from fee contract')
  .addParam('user', 'user address')
  .addParam('value', 'reward amount')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('address', 'fee contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const fee = await createWeb3Contract({ name: 'Fee', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.ether) {
      taskArgs.value = toEther(taskArgs.value);
    }
    await fee.methods.withdraw(taskArgs.value, taskArgs.user).send();
    console.log('Withdraw succeed');
  });

task('fee', 'Query user fee and free fee info')
  .addParam('user', 'user address')
  .addOptionalParam('address', 'router contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const router = await createWeb3Contract({ name: 'Router', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const { fee, freeFee } = await router.methods.estimateTotalFee(taskArgs.user, Math.ceil(Date.now() / 1000)).call();
    console.log('fee:', fee, 'freeFee:', freeFee);
  });

task('afb', 'call onAfterBlock callback')
  .addOptionalParam('address', 'router contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const router = await createWeb3Contract({ name: 'Router', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    // we don't care about active validators
    await router.methods.onAfterBlock([], []).send();
    console.log('onAfterBlock succeed');
  });

task('gb', 'get gxc balance')
  .addParam('user', 'target user')
  .setAction(async (taskArgs, { web3 }) => {
    console.log('GXC:', await web3.eth.getBalance(taskArgs.user));
  });
