// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IValidatorRewardPool.sol";
import "./Only.sol";

contract ValidatorRewardPool is ReentrancyGuard, Only, IValidatorRewardPool {
    using SafeMath for uint256;

    // balance of each validator
    mapping(address => uint256) public override balanceOf;

    constructor(IConfig config) public Only(config) {}

    /**
     * Claim validator reward.
     * @param validator     Validator address.
     * @param amount        Claim amount.
     */
    function claim(address validator, uint256 amount) external override nonReentrant onlyStakeManager {
        balanceOf[validator] = balanceOf[validator].sub(amount, "ValidatorRewardPool: insufficient balance");
        Address.sendValue(msg.sender, amount);
    }

    /**
     * Reward validator.
     * @param validator     Validator address.
     */
    function reward(address validator) external payable override nonReentrant onlyStakeManager {
        require(msg.value > 0, "ValidatorRewardPool: insufficient value");
        balanceOf[validator] = balanceOf[validator].add(msg.value);
    }

    /**
     * Slash validator and transfer the slashed amount to `address(0)`.
     * @param validator     Validator address.
     * @param factor        Slash factor.
     */
    function slash(address validator, uint8 factor) external override nonReentrant onlyStakeManager returns (uint256 amount) {
        require(factor <= 100, "ValidatorRewardPool: invalid factor");
        uint256 balance = balanceOf[validator];
        amount = balance.mul(factor).div(100);
        if (amount > 0) {
            balanceOf[validator] = balance.sub(amount);
            Address.sendValue(address(0), amount);
        }
    }

    /**
     * Slash validator by fixed amount.
     * @param validator     Validator address.
     * @param amount        Slash amount.
     */
    function slashByAmount(address validator, uint256 amount) external override nonReentrant onlyStakeManager {
        balanceOf[validator] = balanceOf[validator].sub(amount, "ValidatorRewardPool: insufficient balance");
        if (amount > 0) {
            Address.sendValue(address(0), amount);
        }
    }
}
