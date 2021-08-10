// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Keeper.sol";

contract UnstakeKeeper is Keeper {
    using SafeMath for uint256;

    uint256 private _totalSupply;

    constructor(address _config, address validator) public Keeper(_config, validator) {}

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function _mint(uint256 amount) private {
        _totalSupply = _totalSupply.add(amount);
    }

    function mint() external payable onlyStakeManager returns (uint256 shares) {
        uint256 amount = msg.value;
        uint256 balance = address(this).balance;
        uint256 reserve = balance.sub(amount);
        uint256 total = _totalSupply;
        if (total == 0) {
            // if there is a balance before the stake, allocate all the balance to the first stake user
            shares = balance;
        } else {
            shares = amount.mul(total).div(reserve);
        }
        require(shares > 0, "UnstakeKeeper: insufficient shares");
        _mint(shares);
    }

    function _burn(uint256 amount) private {
        _totalSupply = _totalSupply.sub(amount);
    }

    function burn(uint256 shares, address payable to) external onlyStakeManager returns (uint256 amount) {
        require(shares > 0, "UnstakeKeeper: insufficient shares");
        uint256 total = _totalSupply;
        if (total == 0) {
            amount = 0;
        } else {
            amount = shares.mul(address(this).balance).div(total);
        }
        _burn(shares);
        if (amount > 0) {
            to.transfer(amount);
        }
    }
}
