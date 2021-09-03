// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFee.sol";
import "./interfaces/IConfig.sol";

/**
 * @dev Implementation of the {IERC20} interface.
 */
contract FeeToken is IERC20 {
    string public name = "Fee";
    string public symbol = "Fee";
    uint8 public decimals = 18;
    IConfig public config;

    constructor(IConfig _config) public {
        config = _config;
    }

    function totalSupply() public view override returns (uint256) {
        return 0;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return IFee(config.fee()).estimateFee(account, block.timestamp);
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
