// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IConfig {
    function stakeManager() external view returns (address);

    function unstakeDelay() external view returns (uint256);

    function minStakeAmount() external view returns (uint256);

    function minUnstakeAmount() external view returns (uint256);

    function getFactorByReason(uint8 reason) external view returns (uint8);

    function setCommissionRateInterval() external view returns (uint256);
}
