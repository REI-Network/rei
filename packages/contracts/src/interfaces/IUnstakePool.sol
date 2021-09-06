// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IOnly.sol";

/**
 * @dev see {UnstakePool}
 */
interface IUnstakePool is IOnly {
    function balanceOf(address addr) external view returns (uint256);

    function totalSupplyOf(address addr) external view returns (uint256);

    function deposit(address validator) external payable returns (uint256);

    function withdraw(
        address validator,
        uint256 shares,
        address payable to
    ) external returns (uint256);

    function slash(address validator, uint8 factor) external returns (uint256);
}
