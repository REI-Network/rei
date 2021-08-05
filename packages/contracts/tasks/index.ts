import { task } from 'hardhat/config';
import type Web3 from 'web3';
import { BN } from 'ethereumjs-util';

function toBN(data: number | string) {
  if (typeof data === 'string' && data.startsWith('0x')) {
    return new BN(data.substr(2), 'hex');
  }
  return new BN(data);
}

async function createWeb3Contract({ name, artifactName, address, deployments, web3, from }: any) {
  const { getArtifact, get } = deployments;
  return new (web3 as Web3).eth.Contract((await getArtifact(artifactName ? artifactName : name)).abi, address ? address : (await get(name)).address, from ? { from } : undefined);
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

task('init', 'Initialize config').setAction(async (taskArgs, { deployments, web3, getNamedAccounts }) => {
  const { deployer } = await getNamedAccounts();
  const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3 });
  const config = await createWeb3Contract({ name: 'Config', deployments, web3, from: deployer });
  await config.methods.setStakeManager(stakeManager.options.address).send();
  console.log('Initialize config finished');
});

task('getsm', 'Get stake manager address').setAction(async (taskArgs, { deployments, web3 }) => {
  const config = await createWeb3Contract({ name: 'Config', deployments, web3 });
  console.log('Stake manager address:', await config.methods.stakeManager().call());
});

task('stake', 'Stake to validator')
  .addParam('validator', 'validator address')
  .addOptionalParam('value', 'stake value')
  .addFlag('ether', 'use ether as unit')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, from: deployer });
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
