import { task } from 'hardhat/config';

async function createWeb3Contract({ name, artifactName, address, deployments, web3, from }: any) {
  const { getArtifact, get } = deployments;
  const addr = address ? address : (await get(name)).address;
  const contract = new web3.eth.Contract((await getArtifact(artifactName ? artifactName : name)).abi, addr, from ? { from } : undefined);
  return { addr, contract };
}

task('init', 'Initialize config').setAction(async (taskArgs, { deployments, web3, getNamedAccounts }) => {
  const { deployer } = await getNamedAccounts();
  const { contract: stakeManager } = await createWeb3Contract({ name: 'StakeManager', deployments, web3 });
  const { contract: config } = await createWeb3Contract({ name: 'Config', deployments, web3, from: deployer });
  await config.methods.setStakeManager(stakeManager.options.address).send();
  console.log('Initialize config finished');
});

task('getStakeManager', 'Get stake manager address').setAction(async (taskArgs, { deployments, web3 }) => {
  const { contract: config } = await createWeb3Contract({ name: 'Config', deployments, web3 });
  console.log('Stake manager address:', await config.methods.stakeManager().call());
});

task('transfer', 'Transfer value to target address')
  .addParam('to', 'to address')
  .addParam('value', 'transfer value')
  .setAction(async (taskArgs, { web3, getNamedAccounts }) => {
    const { deployer } = await getNamedAccounts();
    await web3.eth.sendTransaction({
      from: deployer,
      to: taskArgs.to,
      value: taskArgs.value
    });
    console.log('Transfer succeed');
  });
