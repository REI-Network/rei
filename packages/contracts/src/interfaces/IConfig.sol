// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

/**
 * @dev see {Config}
 */
interface IConfig {
    function stakeManager() external view returns (address);

    function systemCaller() external view returns (address);

    function unstakePool() external view returns (address);

    function validatorRewardPool() external view returns (address);

    function unstakeDelay() external view returns (uint256);

    function minIndexVotingPower() external view returns (uint256);

    function getFactorByReason(uint8 reason) external view returns (uint8);

    function setCommissionRateInterval() external view returns (uint256);
}
