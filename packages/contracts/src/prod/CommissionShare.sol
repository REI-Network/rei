// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IConfig.sol";
import "../interfaces/ICommissionShare.sol";
import "../libraries/Math.sol";
import "./Keeper.sol";

contract CommissionShare is ERC20, Keeper, ICommissionShare {
    using Math for uint256;

    constructor(address config, address validator) public ERC20("Share", "S") Keeper(config, validator) {}

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     * @param shares    Number of shares
     */
    function estimateStakeAmount(uint256 shares) external view override returns (uint256 amount) {
        require(shares > 0, "Share: insufficient shares");
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            amount = shares;
        } else {
            amount = address(this).balance.mul(shares).ceilDiv(_totalSupply);
        }
    }

    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     * @param amount    Number of GXC
     */
    function estimateUnstakeShares(uint256 amount) external view override returns (uint256 shares) {
        require(amount > 0, "Share: insufficient amount");
        uint256 balance = address(this).balance;
        if (balance == 0) {
            shares = 0;
        } else {
            shares = amount.mul(totalSupply()).ceilDiv(balance);
        }
    }

    /**
     * @dev Mint share token to `to` address.
     *      Can only be called by stake manager.
     * @param to        Receiver address
     */
    function mint(address to) external payable override onlyStakeManager returns (uint256 shares) {
        uint256 amount = msg.value;
        uint256 balance = address(this).balance;
        uint256 reserve = balance.sub(amount);
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            // if there is a balance before the stake, allocate all the balance to the first stake user
            shares = balance;
        } else {
            require(reserve > 0, "Share: insufficient validator balance");
            shares = amount.mul(_totalSupply) / reserve;
        }
        require(shares > 0, "Share: insufficient shares");
        _mint(to, shares);
    }

    /**
     * @dev Burn shares and return GXC to `to` address.
     *      Can only be called by stake manager.
     * @param shares    Number of shares to be burned
     * @param to        Receiver address
     */
    function burn(uint256 shares, address payable to) external override onlyStakeManager returns (uint256 amount) {
        require(shares > 0, "Share: insufficient shares");
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            amount = 0;
        } else {
            amount = shares.mul(address(this).balance).div(_totalSupply);
        }
        _burn(msg.sender, shares);
        if (amount > 0) {
            to.transfer(amount);
        }
    }
}
