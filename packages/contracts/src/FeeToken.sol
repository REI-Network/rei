// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFee.sol";
import "./interfaces/IFreeFee.sol";
import "./interfaces/IConfig.sol";

/**
 * @dev Implementation of the {IERC20} interface.
 */
abstract contract AbstractToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    IConfig public config;

    constructor(
        IConfig _config,
        string memory _name,
        string memory _symbol
    ) public {
        config = _config;
        name = _name;
        symbol = _symbol;
    }

    function totalSupply() public view override returns (uint256) {
        return 0;
    }

    function balanceOf(address) public view virtual override returns (uint256) {
        return 0;
    }

    function transfer(address, uint256) public virtual override returns (bool) {
        revert();
    }

    function allowance(address, address) public view virtual override returns (uint256) {
        return 0;
    }

    function approve(address, uint256) public virtual override returns (bool) {
        revert();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) public virtual override returns (bool) {
        revert();
    }
}

contract FeeToken is AbstractToken {
    constructor(IConfig _config) public AbstractToken(_config, "Fee", "Fee") {}

    function balanceOf(address account) public view virtual override returns (uint256) {
        return IFee(config.fee()).estimateFee(account, block.timestamp);
    }
}

contract FreeFeeToken is AbstractToken {
    constructor(IConfig _config) public AbstractToken(_config, "FreeFee", "FreeFee") {}

    function balanceOf(address account) public view virtual override returns (uint256) {
        return IFreeFee(config.freeFee()).estimateFreeFee(account, block.timestamp);
    }
}
