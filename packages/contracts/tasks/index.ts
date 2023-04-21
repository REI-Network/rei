import { task } from 'hardhat/config';

task('deploy-bls', 'Deploy validator bls contract')
  .addParam('genesisInfo', 'Genesis validator address and public key, format: address1:pk1,address2:pk2')
  .setAction(async function (args, { ethers }) {
    const addresses: string[] = [];
    const pks: string[] = [];
    for (const info of (args.genesisInfo as string).split(',')) {
      const index = info.indexOf(':');
      if (index === -1) {
        throw new Error('invalid genesis info');
      }
      const address = info.substring(0, index);
      const pk = info.substring(index + 1);
      if (!address.startsWith('0x') || address.length !== 42 || !pk.startsWith('0x') || pk.length !== 98) {
        throw new Error('invalid genesis info');
      }
      addresses.push(address);
      pks.push(pk);
    }
    const ValidatorBls = await ethers.getContractFactory('ValidatorBls');
    const validatorBls = await ValidatorBls.deploy(addresses, pks);
    console.log('tx sent:', validatorBls.deployTransaction.hash);
    await validatorBls.deployed();
    console.log('contract deployed at:', validatorBls.address);
  });
