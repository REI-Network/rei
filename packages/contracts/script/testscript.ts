import path from 'path';
import fs from 'fs';

const ignoreFiles = ['Config.sol', 'Keeper.sol'];
const commissionAdd = `    
    ///////////////////// only for test /////////////////////

    // reward validator
    function reward() external payable onlyStakeManager {}

    // slash validator
    function slash(uint8 reason) external onlyStakeManager returns (uint256 amount) {
        uint8 factor = config.getFactorByReason(reason);
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }`;

const stakeManagerAdd = `    
    ///////////////////// only for test /////////////////////

    function reward(address validator) external payable returns (uint256 validatorReward, uint256 commissionReward) {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        commissionReward = msg.value.mul(v.commissionRate).div(100);
        validatorReward = msg.value.sub(commissionReward);
        if (commissionReward > 0) {
            CommissionShare(v.commissionShare).reward{ value: commissionReward }();
        }
        if (validatorReward > 0) {
            ValidatorKeeper(v.validatorKeeper).reward{ value: validatorReward }();
        }
    }

    function slash(address validator, uint8 reason) external returns (uint256 amount) {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        amount = CommissionShare(v.commissionShare).slash(reason).add(ValidatorKeeper(v.validatorKeeper).slash(reason)).add(UnstakeKeeper(v.unstakeKeeper).slash(reason));
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }`;

const unstakeKeeperAdd = `    
    ///////////////////// only for test /////////////////////

    // reward validator
    function reward() external payable onlyStakeManager {}

    // slash validator
    function slash(uint8 reason) external onlyStakeManager returns (uint256 amount) {
        uint8 factor = config.getFactorByReason(reason);
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }`;

const validatorKeeperAdd1 = `///////////////////// only for test /////////////////////
import "@openzeppelin/contracts/math/SafeMath.sol";
`;
const validatorKeeperAdd2 = `    ///////////////////// only for test /////////////////////
    using SafeMath for uint256;
`;
const validatorKeeperAdd3 = `    
    ///////////////////// only for test /////////////////////

    // reward validator
    function reward() external payable onlyStakeManager {}

    // slash validator
    function slash(uint8 reason) external onlyStakeManager returns (uint256 amount) {
        uint8 factor = config.getFactorByReason(reason);
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }`;
const importAdd1 = '{ CommissionShare_test as CommissionShare } from';
const importAdd2 = '{ ValidatorKeeper_test as ValidatorKeeper } from';
const importAdd3 = '{ UnstakeKeeper_test as UnstakeKeeper } from';

const rootdir = path.resolve(__dirname, '..');
const proddir = path.join(rootdir, '/src/prod');
const testdir = path.join(rootdir, '/src/test');
const solidityFiles = fs.readdirSync(proddir).filter((x) => {
  if (!ignoreFiles.includes(x)) {
    return x;
  }
});

function insertToFile(path: string, toInsert: string, offset: number, startwith: string) {
  let data = fs.readFileSync(path, 'utf-8').split(/\r\n|\n|\r/gm);
  let i = 0;
  for (; i < data.length; i++) {
    if (data[i].startsWith(startwith)) {
      break;
    }
  }
  data.splice(i + offset, 0, toInsert);
  fs.writeFileSync(path, data.join('\r\n'));
}

fs.copyFileSync(path.join(proddir, '/Keeper.sol'), path.join(testdir, '/Keeper.sol'));
solidityFiles.forEach((filename) => {
  fs.copyFileSync(path.join(proddir, filename), path.join(testdir, filename));
  let fileData = fs.readFileSync(path.join(testdir, filename), 'utf-8').split(/\r\n|\n|\r/gm);
  let i = 0;
  for (; i < fileData.length; i++) {
    if (fileData[i].startsWith('contract')) {
      let toReplace = fileData[i].split(' ');
      toReplace[1] = toReplace[1] + '_test';
      fileData[i] = toReplace.join(' ');
      break;
    }
  }
  fs.writeFileSync(path.join(testdir, filename), fileData.join('\r\n'));
});

insertToFile(path.join(testdir, '/CommissionShare.sol'), commissionAdd, 0, '}');
insertToFile(path.join(testdir, '/StakeManager.sol'), stakeManagerAdd, 0, '}');
insertToFile(path.join(testdir, '/UnstakeKeeper.sol'), unstakeKeeperAdd, 0, '}');
insertToFile(path.join(testdir, '/ValidatorKeeper.sol'), validatorKeeperAdd1, 0, 'contract');
insertToFile(path.join(testdir, '/ValidatorKeeper.sol'), validatorKeeperAdd2, 1, 'contract');
insertToFile(path.join(testdir, '/ValidatorKeeper.sol'), validatorKeeperAdd3, 0, '}');

let fileData = fs.readFileSync(path.join(testdir, '/StakeManager.sol'), 'utf-8').split(/\r\n|\n|\r/gm);
for (let i = 0; i < fileData.length; i++) {
  if (fileData[i].startsWith('import')) {
    const data = fileData[i].split(' ');
    switch (data[1]) {
      case '"./CommissionShare.sol";':
        data.splice(1, 0, importAdd1);
        fileData[i] = data.join(' ');
        break;
      case '"./ValidatorKeeper.sol";':
        data.splice(1, 0, importAdd2);
        fileData[i] = data.join(' ');
        break;
      case '"./UnstakeKeeper.sol";':
        data.splice(1, 0, importAdd3);
        fileData[i] = data.join(' ');
        break;
    }
  }
}
fs.writeFileSync(path.join(testdir, '/StakeManager.sol'), fileData.join('\r\n'));
