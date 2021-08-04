# @gxchain2/contracts

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/contracts)](https://www.npmjs.org/package/@gxchain2/contracts)
![License](https://img.shields.io/npm/l/@gxchain2/contracts)

GXChain2.0 genesis contracts

- `Config` Global config contract, deployed at `0x0000000000000000000000000000000000001000`
- `Share` User share contract, dynamically deployed for each validator
- `StakeManger` Stake manager contract, deployed at `0x0000000000000000000000000000000000001001`

## INSTALL

```sh
npm install @gxchain2/contracts
```

## USAGE

```solidity
// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@gxchain2/contracts/src/interfaces/IStakeManager.sol";
import "@gxchain2/contracts/src/interfaces/IShare.sol";

// candy token for stake user
contract Candy is ERC20Burnable, Ownable  {
    constructor() public ERC20("Candy", "CD") {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

contract LockedStake {
    using SafeMath for uint256;

    // lock the shares until 4 weeks later
    uint256 public unstakeDelay = 4 weeks;
    address public validator;
    Candy public candy;
    IStakeManager public sm;
    mapping(uint256 => uint256) public stakeTimestampOf;
    mapping(uint256 => uint256) public stakeSharesOf;
    mapping(uint256 => address) public stakeOwnerOf;

    // auto-increment id for each stack
    uint256 private autoIncrement = 0;

    event Stake(address indexed staker, uint256 indexed id, uint256 amount, uint256 shares);

    constructor(address _validator, Candy _candy, IStakeManager _sm) public {
        validator = _validator;
        candy = _candy;
        sm = _sm;
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

    function unstake(address payable to, uint256 id) external {
        require(stakeTimestampOf[id].add(unstakeDelay) >= block.timestamp, "LockedStake: invalid id or timestamp");
        require(stakeOwnerOf[id] == msg.sender, "LockedStake: invalid stake owner");
        uint256 _shares = stakeSharesOf[id];
        IShare(sm.getShareContractAddress(validator, true)).approve(address(sm), _shares);
        sm.startUnstake(validator, to, _shares);
        delete stakeTimestampOf[id];
        delete stakeSharesOf[id];
        delete stakeOwnerOf[id];
    }
}
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
