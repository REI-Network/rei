import { DeployFunction } from 'hardhat-deploy/dist/types';

const func: DeployFunction = async function ({ deployments, getNamedAccounts }) {
  const { deploy, execute } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await deploy('Config_devnet', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: []
  });
  await execute('Config_devnet', { from: deployer }, 'setSystemCaller', deployer);

  const deployContract = async (name: string, set: boolean = true, args: any[] = [config.address]) => {
    const contract = await deploy(name, {
      from: deployer,
      log: true,
      deterministicDeployment: false,
      args: args
    });
    if (set) {
      await execute('Config_devnet', { from: deployer }, `set${name}`, contract.address);
    }
  };

  await deployContract('UnstakePool');
  await deployContract('ValidatorRewardPool');
  await deployContract('StakeManager', true, [config.address, deployer, [], []]);
  await deployContract('Fee');
  await deployContract('FeePool');
  // FeeToken requires special precompile function support,
  // only available on rei-network
  // await deployContract('FeeToken');
};

export default func;
