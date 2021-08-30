import { DeployFunction } from 'hardhat-deploy/dist/types';

const func: DeployFunction = async function ({ deployments, getNamedAccounts }) {
  const { deploy, execute } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await deploy('Config_test', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: []
  });

  const unstakeManager = await deploy('UnstakeManager', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [config.address]
  });

  const validatorRewardManager = await deploy('ValidatorRewardManager', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [config.address]
  });

  await execute('Config_test', { from: deployer }, 'setUnstakeManager', unstakeManager.address);
  await execute('Config_test', { from: deployer }, 'setValidatorRewardManager', validatorRewardManager.address);

  const stakeManager = await deploy('StakeManager', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [config.address, []]
  });

  await execute('Config_test', { from: deployer }, 'setStakeManager', stakeManager.address);
  await execute('Config_test', { from: deployer }, 'setSystemCaller', deployer);
};

export default func;
