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

task('init', 'Initialize config').setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
  const { deployer } = await getNamedAccounts();
  const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts });
  const config = await createWeb3Contract({ name: 'Config', deployments, web3, from: deployer });
  await config.methods.setStakeManager(stakeManager.options.address).send();
  console.log('Initialize config finished');
});

task('getsm', 'Get stake manager address').setAction(async (taskArgs, { deployments, web3, artifacts }) => {
  const config = await createWeb3Contract({ name: 'Config', deployments, web3, artifacts });
  console.log('Stake manager address:', await config.methods.stakeManager().call());
});

task('stake', 'Stake to validator')
  .addParam('validator', 'validator address')
  .addOptionalParam('value', 'stake value')
  .addFlag('ether', 'use ether as unit')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer });
    if (taskArgs.value === undefined) {
      taskArgs.value = await stakeManager.methods.estimateMinStakeAmount(taskArgs.validator).call();
    } else if (taskArgs.ether) {
      taskArgs.value = toBN(taskArgs.value)
        .mul(new BN(10).pow(new BN(18)))
        .toString();
    }
    await stakeManager.methods.stake(taskArgs.validator, deployer).send({ value: taskArgs.value });
    console.log('Stake succeed, value:', taskArgs.value);
  });

task('approve', 'Approve share')
  .addParam('validator', 'validator address')
  .addOptionalParam('spender', 'approve spender')
  .addOptionalParam('amount', 'approve amount')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer });
    const shareAddress = await stakeManager.methods.validatorToShare(taskArgs.validator).call();
    if (shareAddress === '0x0000000000000000000000000000000000000000') {
      console.log("validator doesn't exsit!");
      return;
    }
    const share = await createWeb3Contract({ name: 'Share', address: shareAddress, deployments, web3, artifacts, from: deployer });
    if (taskArgs.amount === undefined) {
      taskArgs.amount = MAX_INTEGER.toString();
    }
    await share.methods.approve(taskArgs.spender ?? stakeManager.options.address, taskArgs.amount).send();
    console.log('Approve succeed, amount:', taskArgs.amount);
  });

task('balance', 'Get balance')
  .addParam('address', 'address')
  .addOptionalParam('validator', 'validator address')
  .addOptionalParam('contract', 'ERC20 contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    if (taskArgs.contract === undefined) {
      console.log('GXC balance:', await (web3 as Web3).eth.getBalance(taskArgs.address));
    } else if (taskArgs.validator === undefined) {
      const share = await createWeb3Contract({ name: 'Share', deployments, web3, artifacts, address: taskArgs.contract });
      console.log(await share.methods.name().call(), 'balance:', await share.methods.balanceOf(taskArgs.address).call());
    } else {
      const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts });
      const shareAddress = await stakeManager.methods.validatorToShare(taskArgs.validator).call();
      if (shareAddress === '0x0000000000000000000000000000000000000000') {
        console.log("validator doesn't exsit!");
        return;
      }
      const share = await createWeb3Contract({ name: 'Share', address: shareAddress, deployments, web3, artifacts });
      console.log(await share.methods.name().call(), 'balance:', await share.methods.balanceOf(taskArgs.address).call());
    }
  });

task('unstake', 'Start unstake')
  .addParam('validator', 'validator address')
  .addOptionalParam('shares', 'unstake shares')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer });
    if (taskArgs.shares === undefined) {
      taskArgs.shares = await stakeManager.methods.estimateMinUnstakeShares(taskArgs.validator).call();
      if (taskArgs.shares === '0') {
        console.log("validator doesn't exsit!");
        return;
      }
    }
    const { events } = await stakeManager.methods.startUnstake(taskArgs.validator, deployer, taskArgs.shares).send();
    let id;
    if (events) {
      for (const key in events) {
        if (key === 'StartUnstake') {
          id = toBN(events[key].raw.topics[1]).toNumber();
        }
      }
    }
    console.log('Unstake succeed, shares:', taskArgs.shares, 'id:', id);
  });

task('dounstake', 'Do unstake')
  .addOptionalParam('limit', 'gas limit(default max 12450000)')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer });
    const { events, gasUsed } = await stakeManager.methods.doUnstake().send({ gasLimit: taskArgs.limit ?? '12450000' });
    let count = 0;
    if (events) {
      for (const key in events) {
        if (key === 'DoUnstake') {
          let arr;
          if (!Array.isArray(events[key])) {
            arr = [events[key]];
          } else {
            arr = events[key];
          }
          for (const event of arr) {
            const data: string = event.raw.data;
            const amount = toBN('0x' + data.substr(66));
            let address: string = event.raw.topics[2];
            address = '0x' + address.substr(26);
            const id = toBN(event.raw.topics[1]).toNumber();
            console.log('Do unstake address:', address, 'amount:', amount.toString(), 'id:', id);
            count++;
          }
        }
      }
    }
    console.log('Do unstake succeed, process count:', count, 'gas used:', gasUsed);
  });
