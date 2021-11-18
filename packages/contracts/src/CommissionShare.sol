// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ICommissionShare.sol";
import "./libraries/Util.sol";
import "./Only.sol";

contract CommissionShare is ReentrancyGuard, ERC20, Only, ICommissionShare {
    // validator address
    address public validator;

    constructor(IConfig config, address _validator) public ERC20("CommissionShare", "CS") Only(config) {
        validator = _validator;
    }

    /**
     * Estimate how much GXC should be stake, if user wants to get the number of shares, or estimate how much GXC can be obtained, if user unstake the amount of GXC.
     * @param shares    Number of shares
     */
    function estimateSharesToAmount(uint256 shares) external view override returns (uint256 amount) {
        require(shares > 0, "CommissionShare: insufficient shares");
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            amount = shares;
        } else {
            amount = Util.divCeil(address(this).balance.mul(shares), _totalSupply);
        }
    }

    /**
     * Estimate how much shares should be unstake, if user wants to get the amount of GXC, or estimate how much shares can be obtained, if user stake the amount of GXC.
     * @param amount    Number of GXC
     */
    function estimateAmountToShares(uint256 amount) external view override returns (uint256 shares) {
        require(amount > 0, "CommissionShare: insufficient amount");
        uint256 balance = address(this).balance;
        if (balance == 0) {
            shares = 0;
        } else {
            shares = Util.divCeil(amount.mul(totalSupply()), balance);
        }
    }

    /**
     * Mint share token to `to` address. Can only be called by stake manager.
     * @param to        Receiver address
     */
    function mint(address to) external payable override nonReentrant onlyStakeManager returns (uint256 shares) {
        uint256 balance = address(this).balance;
        uint256 reserve = balance.sub(msg.value);
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            // if there is a balance before the stake, allocate all the balance to the first stake user
            shares = balance;
        } else {
            require(reserve > 0, "CommissionShare: insufficient validator balance");
            shares = msg.value.mul(_totalSupply) / reserve;
        }
        require(shares > 0, "CommissionShare: insufficient shares");
        _mint(to, shares);
    }

    /**
     * Burn shares and return GXC to `to` address. Can only be called by stake manager.
     * @param shares    Number of shares to be burned
     */
    function burn(uint256 shares) external override nonReentrant onlyStakeManager returns (uint256 amount) {
        require(shares > 0, "CommissionShare: insufficient shares");
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            amount = 0;
        } else {
            amount = shares.mul(address(this).balance).div(_totalSupply);
        }
        _burn(msg.sender, shares);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }

    /**
     * Reward validator.
     */
    function reward() external payable override nonReentrant onlyStakeManager {}

    /**
     * Slash validator and transfer the slashed amount to `address(0)`.
     * @param factor        Slash factor.
     */
    function slash(uint8 factor) external override nonReentrant onlyStakeManager returns (uint256 amount) {
        require(factor <= 100, "CommissionShare: invalid factor");
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            address(0).transfer(amount);
        }
    }
}
