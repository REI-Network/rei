// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IUnstakePool.sol";
import "./Only.sol";

contract UnstakePool is ReentrancyGuard, Only, IUnstakePool {
    using SafeMath for uint256;

    // balance of each validators
    mapping(address => uint256) public override balanceOf;
    // total supply of each validators
    mapping(address => uint256) public override totalSupplyOf;

    constructor(IConfig config) public Only(config) {}

    /**
     * Deposit GXC to `UnstakePool`, only can be called by stake manager,
     * this will be called when user starts unstake.
     * @param validator     Validator address.
     */
    function deposit(address validator) external payable override nonReentrant onlyStakeManager returns (uint256 shares) {
        uint256 balance = balanceOf[validator];
        uint256 totalSupply = totalSupplyOf[validator];
        if (totalSupply == 0) {
            // if there is a balance before the stake, allocate all the balance to the first stake user
            shares = balance.add(msg.value);
        } else {
            require(balance > 0, "UnstakePool: insufficient validator balance");
            shares = msg.value.mul(totalSupply).div(balance);
        }
        require(shares > 0, "UnstakePool: insufficient shares");
        balanceOf[validator] = balance.add(msg.value);
        totalSupplyOf[validator] = totalSupply.add(shares);
    }

    /**
     * Withdraw GXC and burn shares, only can be called by stake manager,
     * this will be called when unstake timeout.
     * @param validator     Validator address.
     * @param shares        Number of shares.
     * @param to            GXC receiver address(this value is set when the user starts unstake).
     */
    function withdraw(
        address validator,
        uint256 shares,
        address payable to
    ) external override nonReentrant onlyStakeManager returns (uint256 amount) {
        uint256 balance = balanceOf[validator];
        uint256 totalSupply = totalSupplyOf[validator];
        if (totalSupply == 0) {
            amount = 0;
        } else {
            amount = shares.mul(balance).div(totalSupply);
        }
        totalSupplyOf[validator] = totalSupply.sub(shares, "UnstakePool: insufficient total supply");
        if (amount > 0) {
            balanceOf[validator] = balance.sub(amount);
            to.transfer(amount);
        }
    }

    /**
     * Slash validator and transfer the slashed amount to `address(0)`.
     * @param validator     Validator address.
     * @param factor        Slash factor.
     */
    function slash(address validator, uint8 factor) external override nonReentrant onlyStakeManager returns (uint256 amount) {
        require(factor <= 100, "UnstakePool: invalid factor");
        uint256 balance = balanceOf[validator];
        amount = balance.mul(factor).div(100);
        if (amount > 0) {
            balanceOf[validator] = balance.sub(amount);
            address(0).transfer(amount);
        }
    }
}
