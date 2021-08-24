export default async function ({ deployments, getNamedAccounts }) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await deploy('Config', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: []
  });

  const stakeManager = await deploy('StakeManager', {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [config.address, [deployer]]
  });
}
