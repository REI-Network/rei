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
  await deployContract('ContractFee', true, []);
  await deployContract('Fee');
  await deployContract('FeePool');
  await deployContract('FreeFee');
  await deployContract('FeeToken', false);
  await deployContract('FreeFeeToken', false);
  await deployContract('Router');
  await deployContract('StakeManager', true, [config.address, []]);
};

export default func;
