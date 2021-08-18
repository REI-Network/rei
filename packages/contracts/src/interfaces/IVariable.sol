// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IVariable {
    function reward() external payable;

    function slash(uint8 factor) external returns (uint256);
}
