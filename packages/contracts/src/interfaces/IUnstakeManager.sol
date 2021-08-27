// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IUnstakeManager {
    function deposit(address validator) external payable returns (uint256 shares);

    function withdraw(
        address validator,
        uint256 shares,
        address payable to
    ) external returns (uint256 amount);

    function slash(address validator, uint8 factor) external returns (uint256 amount);
}
