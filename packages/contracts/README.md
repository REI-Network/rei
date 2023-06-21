# @rei-network/contracts

[![NPM Version](https://img.shields.io/npm/v/@rei-network/contracts)](https://www.npmjs.org/package/@rei-network/contracts)
![License](https://img.shields.io/npm/l/@rei-network/contracts)

REI-Network genesis contracts

- `Config` Global config contract, deployed at `0x0000000000000000000000000000000000001000`
- `StakeManager` Stake manager contract, deployed at `0x0000000000000000000000000000000000001001`
- `UnstakePool` A smart contract that keeps unstake amount, deployed at `0x0000000000000000000000000000000000001003`
- `ValidatorRewardPool` A smart contract that keeps validator reward for validator, deployed at `0x0000000000000000000000000000000000001004`
- `CommmissionShare` A smart contract that keeps commission reward for all staking user, dynamically deployed for each validator
- `Fee` A smart contract for staking REI to get Crude, deployed at `0x0000000000000000000000000000000000001005`
- `FeePool` A smart contract for distributing miner fee rewards, deployed at `0x0000000000000000000000000000000000001006`
- `FeeToken` A smart contract for querying the user's remaining Crude quantity, deployed at `0x0000000000000000000000000000000000001007`
- `Prison` A smart contract for jailing validator which not mint blocks on time, deployed at `0x0000000000000000000000000000000000001008`
- `ValidatorBLS` A smart contract that manages the validator's BLS public key, deployed at `0x0000000000000000000000000000000000001009`

## Install

```sh
npm install @rei-network/contracts
```

## Usage

```solidity
// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@rei-network/contracts/src/interfaces/IStakeManager.sol";
import "@rei-network/contracts/src/interfaces/ICommissionShare.sol";

// candy token for stake user
// after deployment, the `transferOwnership` method should be called
// to transfer ownership to the `LockedStake` contract
contract Candy is ERC20Burnable, Ownable {
  constructor() public ERC20("Candy", "CD") {}

  function mint(address to, uint256 amount) external onlyOwner {
    _mint(to, amount);
  }
}

/**
 * A locked staking smart contract,
 * user stake for validator can get candy reward,
 * but only can start unstake after `lockTime`
 */
contract LockedStake {
  using SafeMath for uint256;

  // lock the shares until 4 weeks later
  uint256 public lockTime = 4 weeks;
  address public validator;
  Candy public candy;
  IStakeManager public sm;
  mapping(uint256 => uint256) public stakeTimestampOf;
  mapping(uint256 => uint256) public stakeSharesOf;
  mapping(uint256 => address) public stakeOwnerOf;

  // auto-increment id for each stack
  uint256 private autoIncrement = 0;

  event Stake(
    address indexed staker,
    uint256 indexed id,
    uint256 amount,
    uint256 shares
  );

  event Unstake(uint256 indexed unstakeId);

  constructor(address _validator, Candy _candy) public {
    validator = _validator;
    candy = _candy;
    sm = IStakeManager(0x0000000000000000000000000000000000001001);
  }

  function stake() external payable returns (uint256 id) {
    id = autoIncrement;
    autoIncrement = id.add(1);
    uint256 shares = sm.stake{ value: msg.value }(validator, address(this));
    stakeTimestampOf[id] = block.timestamp;
    stakeSharesOf[id] = shares;
    stakeOwnerOf[id] = msg.sender;
    candy.mint(msg.sender, shares);
    emit Stake(msg.sender, id, msg.value, shares);
  }

  function unstake(uint256 id, address payable to)
    external
    returns (uint256 unstakeId)
  {
    uint256 timestamp = stakeTimestampOf[id];
    require(
      timestamp != 0 && timestamp.add(lockTime) >= block.timestamp,
      "LockedStake: invalid id or timestamp"
    );
    require(stakeOwnerOf[id] == msg.sender, "LockedStake: invalid stake owner");
    uint256 _shares = stakeSharesOf[id];
    // we should approve the shares to stake manager before starting unstake
    ICommissionShare(sm.validators(validator).commissionShare).approve(
      address(sm),
      _shares
    );
    // stake manager will burn the shares and return the REI after `config.unstakeDelay`
    unstakeId = sm.startUnstake(validator, to, _shares);
    delete stakeTimestampOf[id];
    delete stakeSharesOf[id];
    delete stakeOwnerOf[id];
    emit Unstake(unstakeId);
  }
}

```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
