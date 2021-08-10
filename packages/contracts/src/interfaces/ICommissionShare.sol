// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICommissionShare is IERC20 {
    function validator() external view returns (address);

    function estimateStakeAmount(uint256 shares) external view returns (uint256);

    function estimateUnstakeShares(uint256 amount) external view returns (uint256);

    function mint(address to) external payable returns (uint256);

    function burn(uint256 shares, address payable to) external returns (uint256);
}
