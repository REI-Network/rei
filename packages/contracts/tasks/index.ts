import { task } from 'hardhat/config';

task('deploy-bls', 'Deploy validator bls contract')
  .addParam('genesisInfo', 'Genesis validator address and public key, format: address1:pk1,address2:pk2,...')
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

task('register', 'Register bls public key')
  .addParam('validatorInfo', 'format: address1:pk1,address2:pk2,...')
  .setAction(async function (args, { ethers }) {
    const signers = await ethers.getSigners();
    const ValidatorBls = await ethers.getContractFactory('ValidatorBls');
    const validatorBls = ValidatorBls.attach('0x0000000000000000000000000000000000001009');
    for (const info of (args.genesisInfo as string).split(',')) {
      const index = info.indexOf(':');
      if (index === -1) {
        throw new Error('invalid validator info');
      }
      const address = info.substring(0, index);
      const pk = info.substring(index + 1);
      if (!address.startsWith('0x') || address.length !== 42 || !pk.startsWith('0x') || pk.length !== 98) {
        throw new Error('invalid validator info');
      }
      const validators = signers.filter(({ address: _address }) => _address.toLocaleLowerCase() === address.toLocaleLowerCase());
      if (validators.length === 0) {
        throw new Error(`unknown validator: ${address}`);
      }
      const tx = await validatorBls.connect(validators[0]).setBlsPublicKey(pk);
      console.log('register for', address, 'tx sent:', tx.hash);
      await tx.wait();
      console.log('register for', address, 'finished');
    }
  });

task('stake', 'Stake for validators')
  .addParam('validatorInfo', 'Validator address and ethers value, format: address1:value1,address2:value2,...')
  .setAction(async function (args, { ethers }) {
    const signer = (await ethers.getSigners())[0];
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const stakeManger = StakeManager.attach('0x0000000000000000000000000000000000001001');
    for (const info of (args.validatorInfo as string).split(',')) {
      const index = info.indexOf(':');
      if (index === -1) {
        throw new Error('invalid validator info');
      }
      const address = info.substring(0, index);
      const value = info.substring(index + 1);
      if (!address.startsWith('0x') || address.length !== 42) {
        throw new Error('invalid validator info');
      }
      const tx = await stakeManger.stake(address, signer.address, { value: ethers.utils.parseEther(value) });
      console.log('stake', value, 'ethers for', address, 'tx sent:', tx.hash);
      await tx.wait();
      console.log('stake', value, 'ethers for', address, 'finished');
    }
  });

task('unstake', 'Unstake for validators')
  .addParam('validatorInfo', 'Validator address format: address1,address2,...')
  .setAction(async function (args, { ethers }) {
    const signer = (await ethers.getSigners())[0];
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const CommissionShare = await ethers.getContractFactory('CommissionShare');
    const stakeManger = StakeManager.attach('0x0000000000000000000000000000000000001001');
    for (const address of (args.validatorInfo as string).split(',')) {
      if (!address.startsWith('0x') || address.length !== 42) {
        throw new Error('invalid validator info');
      }
      const { commissionShare: commissionShareAddress } = await stakeManger.validators(address);
      const commissionShare = CommissionShare.attach(commissionShareAddress);
      const balance = await commissionShare.balanceOf(signer.address);
      if (balance.eq(0)) {
        console.log('zero balance, skip for:', address);
        continue;
      }
      const allowance = await commissionShare.allowance(signer.address, stakeManger.address);
      if (allowance.eq(0)) {
        console.log('approving...');
        const tx = await commissionShare.approve(stakeManger.address, ethers.constants.MaxUint256);
        await tx.wait();
        console.log('approved');
      }
      const tx = await stakeManger.startUnstake(address, signer.address, balance);
      console.log('unstake for', address, 'tx sent:', tx.hash);
      await tx.wait();
      console.log('unstake for', address, 'finished');
    }
  });

task('claim', 'Claim rewards for validators')
  .addParam('validatorInfo', 'Validator address format: address1,address2,...')
  .setAction(async function (args, { ethers }) {
    const signers = await ethers.getSigners();
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const ValidatorRewardPool = await ethers.getContractFactory('ValidatorRewardPool');
    const stakeManger = StakeManager.attach('0x0000000000000000000000000000000000001001');
    const validatorRewardPool = ValidatorRewardPool.attach('0x0000000000000000000000000000000000001004');
    const validators = (args.validatorInfo as string).split(',').map((address) => {
      const signer = signers.filter(({ address: _address }) => _address.toLocaleLowerCase() === address.toLocaleLowerCase());
      if (signer.length === 0) {
        throw new Error(`unknown validator: ${address}, please import private key`);
      }
      return signer[0];
    });
    for (const validator of validators) {
      const balance = await validatorRewardPool.balanceOf(validator.address);
      if (balance.eq(0)) {
        console.log('zero balance, skip for:', validator.address);
        continue;
      }
      const ethBalance = await ethers.provider.getBalance(validator.address);
      if (ethBalance.eq(0)) {
        throw new Error(`zero eth balance: ${validator.address}`);
      }
      const tx = await stakeManger.connect(validator).startClaim(validator.address, balance);
      console.log('claim', ethers.utils.formatEther(balance), 'ethers for', validator.address, 'tx sent:', tx.hash);
      await tx.wait();
      console.log('claim', ethers.utils.formatEther(balance), 'ethers for', validator.address, 'finished');
    }
  });

task('transfer', 'Transfer ethers to accounts')
  .addParam('accountsInfo', 'format: address1:value1,address2:value2,...')
  .setAction(async function (args, { ethers }) {
    const signer = (await ethers.getSigners())[0];
    for (const info of (args.validatorInfo as string).split(',')) {
      const index = info.indexOf(':');
      if (index === -1) {
        throw new Error('invalid validator info');
      }
      const address = info.substring(0, index);
      const value = info.substring(index + 1);
      if (!address.startsWith('0x') || address.length !== 42) {
        throw new Error('invalid validator info');
      }
      const tx = await signer.sendTransaction({
        to: address,
        value: ethers.utils.parseEther(value)
      });
      console.log('transfer', value, 'ethers for', address, 'tx sent:', tx.hash);
      await tx.wait();
      console.log('transfer', value, 'ethers for', address, 'finished');
    }
  });
