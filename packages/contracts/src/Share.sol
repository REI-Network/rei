// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IShare.sol";

contract Share is ERC20, IShare {
    using SafeMath  for uint256;
    
    IConfig public config;
    address public validator;
    bool public isStake;
    
    modifier onlyStakeManager() {
        require(msg.sender == config.stakeManager(), "Share: only stake manager");
        _;
    }
    
    constructor(address _config, address _validator, bool _isStake) public ERC20("Share", "S") {
        config = IConfig(_config);
        validator = _validator;
        isStake = _isStake;
    }

    function estimateStakeAmount(uint256 shares) external view override returns (uint256 amount) {
        require(shares > 0, "Share: insufficient shares");
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            amount = shares;
        } else {
            amount = address(this).balance.mul(shares).div(_totalSupply);
        }
    }
    
    function estimateUnstakeShares(uint256 amount) external view override returns (uint256 shares) {
        require(amount > 0, "Share: insufficient amount");
        uint256 balance = address(this).balance;
        uint256 _totalSupply = totalSupply();
        require(_totalSupply != 0 && amount <= balance, "Share: invalid total supply or amount");
        shares = amount.mul(_totalSupply).div(balance);
    }

    function mint(address to) external payable override onlyStakeManager returns (uint256 shares) {
        uint256 amount = msg.value;
        uint256 reserve = address(this).balance.sub(amount);
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            shares = amount;
        } else {
            shares = amount.mul(_totalSupply).div(reserve);
        }
        require(shares > 0, "Share: insufficient shares");
        _mint(to, shares);
    }
    
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
    
    function slash(uint8 factor) external override onlyStakeManager returns (uint256 amount) {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            amount = balance.mul(factor).div(100);
            if (balance == amount) {
                amount = amount.sub(1);
            }
            if (amount > 0) {
                address(0).transfer(amount);
            }
        }
    }
}