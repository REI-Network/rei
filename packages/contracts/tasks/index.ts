import type { ethers as HardhatEthers } from 'hardhat';
import { task } from 'hardhat/config';

function parseFuncArg(value: string, ethers: typeof HardhatEthers) {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, value.length - 2).split(',');
  } else if (value === 'true') {
    return true;
  } else if (value === 'false') {
    return false;
  } else if (value === 'max') {
    return ethers.constants.MaxUint256;
  } else {
    return value;
  }
}

task('call', 'Call contract view function')
  .addParam('contract', 'Contract name')
  .addParam('address', 'Contract address')
  .addParam('func', 'Function name')
  .addOptionalParam('arg0', 'Function argument')
  .addOptionalParam('arg1', 'Function argument')
  .addOptionalParam('arg2', 'Function argument')
  .addOptionalParam('arg3', 'Function argument')
  .addOptionalParam('arg4', 'Function argument')
  .addOptionalParam('arg5', 'Function argument')
  .addOptionalParam('arg6', 'Function argument')
  .addOptionalParam('tag', 'Block tag')
  .setAction(async function (args, { ethers }) {
    const contract: any = await ethers.getContractAt(args.contract, args.address);
    const funcArgs: any[] = [];
    for (let i = 0; i < 7; i++) {
      const value = args[`arg${i}`];
      if (value === undefined) {
        break;
      }
      funcArgs.push(parseFuncArg(value, ethers));
    }
    console.log(await contract[args.func](...funcArgs, { blockTag: args.tag }));
  });

task('send-tx', 'Send a transaction to call a contract')
  .addParam('contract', 'Contract name')
  .addParam('address', 'Contract address')
  .addParam('func', 'Function name')
  .addOptionalParam('arg0', 'Function argument')
  .addOptionalParam('arg1', 'Function argument')
  .addOptionalParam('arg2', 'Function argument')
  .addOptionalParam('arg3', 'Function argument')
  .addOptionalParam('arg4', 'Function argument')
  .addOptionalParam('arg5', 'Function argument')
  .addOptionalParam('arg6', 'Function argument')
  .setAction(async function (args, { ethers }) {
    const contract: any = await ethers.getContractAt(args.contract, args.address);
    const funcArgs: any[] = [];
    for (let i = 0; i < 7; i++) {
      const value = args[`arg${i}`];
      if (value === undefined) {
        break;
      }
      funcArgs.push(parseFuncArg(value, ethers));
    }
    const tx = await contract[args.func](...funcArgs);
    const receipt = await tx.wait();
    console.log(receipt.events);
  });

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
    const ValidatorBLS = await ethers.getContractFactory('ValidatorBLS');
    const validatorBLS = await ValidatorBLS.deploy(addresses, pks);
    console.log('tx sent:', validatorBLS.deployTransaction.hash);
    await validatorBLS.deployed();
    console.log('contract deployed at:', validatorBLS.address);
  });

task('register', 'Register bls public key')
  .addParam('validatorInfo', 'format: address1:pk1,address2:pk2,...')
  .addParam('contractAddr', 'ValidatorBLS contract address', '0x0000000000000000000000000000000000001009')
  .setAction(async function (args, { ethers }) {
    const signers = await ethers.getSigners();
    const ValidatorBLS = await ethers.getContractFactory('ValidatorBLS');
    // before hardfork 0x094319890280E2c6430091FEc44822540229ca62, after hardfork 0x0000000000000000000000000000000000001009
    const validatorBLS = ValidatorBLS.attach(args.contractAddr);
    for (const info of (args.validatorInfo as string).split(',')) {
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
      const ethBalance = await ethers.provider.getBalance(validators[0].address);
      if (ethBalance.eq(0)) {
        throw new Error(`zero eth balance: ${validators[0].address}`);
      }
      const tx = await validatorBLS.connect(validators[0]).setBLSPublicKey(pk);
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
      try {
        const tx = await stakeManger.stake(address, signer.address, { value: ethers.utils.parseEther(value) });
        console.log('stake', value, 'ethers for', address, 'tx sent:', tx.hash);
        await tx.wait();
        console.log('stake', value, 'ethers for', address, 'finished');
      } catch (error) {
        console.log('stake failed, error:', error);
      }
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
      try {
        const tx = await stakeManger.startUnstake(address, signer.address, balance);
        console.log('unstake for', address, 'tx sent:', tx.hash);
        await tx.wait();
        console.log('unstake for', address, 'finished');
      } catch (error) {
        console.log('unstake failed, error:', error);
      }
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
      try {
        const tx = await stakeManger.connect(validator).startClaim(validator.address, balance);
        console.log('claim', ethers.utils.formatEther(balance), 'ethers for', validator.address, 'tx sent:', tx.hash);
        await tx.wait();
        console.log('claim', ethers.utils.formatEther(balance), 'ethers for', validator.address, 'finished');
      } catch (error) {
        console.log('claim failed, error:', error);
      }
    }
  });

task('transfer', 'Transfer ethers to accounts')
  .addParam('accountsInfo', 'format: address1:value1,address2:value2,...')
  .setAction(async function (args, { ethers }) {
    const signer = (await ethers.getSigners())[0];
    for (const info of (args.accountsInfo as string).split(',')) {
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

task('get-bls', 'Get bls public key')
  .addParam('validatorInfo', 'format: address1,address2,...')
  .addParam('contractAddr', 'ValidatorBLS contract address')
  .setAction(async function (args, { ethers }) {
    const addresses = (args.validatorInfo as string).split(',');
    const ValidatorBLS = await ethers.getContractFactory('ValidatorBLS');
    const validatorBLS = ValidatorBLS.attach(args.contractAddr);
    for (const address of addresses) {
      if (!address.startsWith('0x') || address.length !== 42) {
        throw new Error('invalid validator info');
      }
      const blsPublicKey = await validatorBLS.getBLSPublicKey(address);
      console.log('bls public key for', address, ':', blsPublicKey);
    }
  });

task('unstake-with-amount', 'Unstake for validators')
  .addParam('validator', 'Validator address')
  .addParam('amount', 'Unstake amount')
  .setAction(async function (args, { ethers }) {
    const signer = (await ethers.getSigners())[0];
    const address = args.validator as string;
    const amount = ethers.utils.parseEther(args.amount as string);
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const CommissionShare = await ethers.getContractFactory('CommissionShare');
    const stakeManger = StakeManager.attach('0x0000000000000000000000000000000000001001');

    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error('invalid validator info');
    }
    const { commissionShare: commissionShareAddress } = await stakeManger.validators(address);
    const commissionShare = CommissionShare.attach(commissionShareAddress);
    const balance = await commissionShare.balanceOf(signer.address);
    if (balance.eq(0)) {
      console.log('zero balance, skip for:', address);
      return;
    }
    const allowance = await commissionShare.allowance(signer.address, stakeManger.address);
    if (allowance.eq(0)) {
      console.log('approving...');
      const tx = await commissionShare.approve(stakeManger.address, ethers.constants.MaxUint256);
      await tx.wait();
      console.log('approved');
    }
    const tx = await stakeManger.startUnstake(address, signer.address, amount);
    console.log('unstake for', address, 'tx sent:', tx.hash);
    await tx.wait();
    console.log('unstake for', address, 'finished');
  });

task('get-balance', 'Get stake info')
  .addParam('validatorInfo', 'format: address1,address2,...')
  .setAction(async function (args, { ethers }) {
    const addresses = (args.validatorInfo as string).split(',');
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const RewardPool = await ethers.getContractFactory('ValidatorRewardPool');
    const UnstakePool = await ethers.getContractFactory('UnstakePool');

    const stakeManger = StakeManager.attach('0x0000000000000000000000000000000000001001');
    const unstakePool = UnstakePool.attach('0x0000000000000000000000000000000000001003');
    const rewardPool = RewardPool.attach('0x0000000000000000000000000000000000001004');
    for (const address of addresses) {
      const { commissionShare: commissionShareAddress } = await stakeManger.validators(address);
      const balance = await ethers.provider.getBalance(commissionShareAddress);
      const reward = await rewardPool.balanceOf(address);
      const unstake = await unstakePool.balanceOf(address);
      console.log(`validator ${address}  commissionShare balance : `, ethers.utils.formatEther(balance));
      console.log(`validator ${address}  reward : `, ethers.utils.formatEther(reward));
      console.log(`validator ${address}  unstake : `, ethers.utils.formatEther(unstake));
    }
  });

task('check-validator-info')
  .addParam('validator', 'Validator address')
  .setAction(async function (args, { ethers }) {
    const validator = args.validator as string;
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const stakeManager = StakeManager.attach('0x0000000000000000000000000000000000001001');
    console.log('totalLockAmount : ', (await stakeManager.totalLockedAmount()).toString());
    const v = await stakeManager.validators(validator);
    console.log('is indexedValidator', await stakeManager.indexedValidatorsExists(v.id));
    console.log('is frozen', await stakeManager.frozen(validator));
    console.log('votingPower ', (await stakeManager.getVotingPowerByAddress(validator)).toString());
  });

task('unfreeze', 'Unfreeze for validators')
  .addParam('validator', 'Validator address')
  .addParam('factorOrAmount', 'Unfreeze factor or amount')
  .setAction(async function (args, { ethers }) {
    const validator = args.validator as string;
    const factorOrAmount = args.factorOrAmount as string;
    const configOwner = new ethers.Wallet('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', ethers.provider);
    const StakeManager = await ethers.getContractFactory('StakeManager');
    const stakeManager = StakeManager.attach('0x0000000000000000000000000000000000001001');
    const tx = await stakeManager.connect(configOwner).unfreeze(validator, factorOrAmount);
    console.log('unfreeze for', validator, 'tx sent:', tx.hash);
    await tx.wait();
    console.log('unfreeze for', validator, 'finished');
  });
