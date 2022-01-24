// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFee.sol";

/**
 * @dev Implementation of the {IERC20} interface.
 */
abstract contract AbstractToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;

    constructor(string memory _name, string memory _symbol) public {
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
    constructor() public AbstractToken("Crude", "Crude") {}

    function balanceOf(address account) public view virtual override returns (uint256) {
        (bool success, bytes memory returndata) = address(0x00000000000000000000000000000000000000ff).staticcall(abi.encode(account, block.timestamp));
        require(success);
        return abi.decode(returndata, (uint256));
    }
}
