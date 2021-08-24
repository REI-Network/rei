// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IKeeper.sol";

interface IUnstakeKeeper is IKeeper {
    function totalSupply() external view returns (uint256);

    function estimateUnstakeAmount(uint256 shares) external view returns (uint256 amount);

    function mint() external payable returns (uint256);

    function burn(uint256 shares, address payable to) external returns (uint256);
}
