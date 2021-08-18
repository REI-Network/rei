// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IEstimator {
    function estimateMinStakeAmount(address validator) external view returns (uint256);

    function estimateStakeAmount(address validator, uint256 shares) external view returns (uint256);

    function estimateMinUnstakeShares(address validator) external view returns (uint256);

    function estimateUnstakeShares(address validator, uint256 amount) external view returns (uint256);

    function estimateUnstakeAmount(address validator, uint256 shares) external view returns (uint256);
}
