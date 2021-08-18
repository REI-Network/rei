// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IUnstakeKeeper.sol";
import "./Keeper.sol";

contract UnstakeKeeper is Keeper, IUnstakeKeeper {
    // shares total supply
    uint256 private _totalSupply;

    constructor(address _config, address validator) public Keeper(_config, validator) {}

    /**
     * @dev Get total supply
     */
    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     * @param shares    Number of shares
     */
    function estimateUnstakeAmount(uint256 shares) external view override returns (uint256 amount) {
        require(shares > 0, "Share: insufficient shares");
        uint256 total = _totalSupply;
        if (total == 0) {
            amount = 0;
        } else {
            amount = address(this).balance.mul(shares).div(total);
        }
    }

    function _mint(uint256 amount) private {
        _totalSupply = _totalSupply.add(amount);
    }

    /**
     * @dev Mint shares.
     *      Can only be called by stake manager.
     */
    function mint() external payable override onlyStakeManager returns (uint256 shares) {
        uint256 amount = msg.value;
        uint256 balance = address(this).balance;
        uint256 reserve = balance.sub(amount);
        uint256 total = _totalSupply;
        if (total == 0) {
            // if there is a balance before the stake, allocate all the balance to the first stake user
            shares = balance;
        } else {
            require(reserve > 0, "UnstakeKeeper: insufficient validator balance");
            shares = amount.mul(total).div(reserve);
        }
        require(shares > 0, "UnstakeKeeper: insufficient shares");
        _mint(shares);
    }

    function _burn(uint256 amount) private {
        _totalSupply = _totalSupply.sub(amount);
    }

    /**
     * @dev Burn shares and return GXC to `to` address.
     *      Can only be called by stake manager.
     * @param shares    Number of shares to be burned
     * @param to        Receiver address
     */
    function burn(uint256 shares, address payable to) external override onlyStakeManager returns (uint256 amount) {
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
