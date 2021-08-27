// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Only.sol";

contract ValidatorRewardManager is Only {
    using SafeMath for uint256;

    mapping(address => uint256) public balanceOf;

    constructor(IConfig config) public Only(config) {}

    function claim(address validator, uint256 amount) external onlyStakeManager {
        balanceOf[validator] = balanceOf[validator].sub(amount, "ValidatorRewardManager: insufficient balance");
        msg.sender.transfer(amount);
    }

    function reward(address validator) external payable onlyStakeManager {
        require(msg.value > 0, "ValidatorRewardManager: insufficient value");
        balanceOf[validator] = balanceOf[validator].add(msg.value);
    }

    function slash(address validator, uint8 factor) external onlyStakeManager returns (uint256 amount) {
        require(factor <= 100, "ValidatorRewardManager: invalid factor");
        uint256 balance = balanceOf[validator];
        amount = balance.mul(factor).div(100);
        balanceOf[validator] = balance.sub(amount);
    }
}
