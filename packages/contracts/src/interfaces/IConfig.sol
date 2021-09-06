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

    function fee() external view returns (address);

    function freeFee() external view returns (address);

    function feePool() external view returns (address);

    function router() external view returns (address);

    function unstakeDelay() external view returns (uint256);

    function withdrawDelay() external view returns (uint256);

    function dailyFee() external view returns (uint256);

    function dailyFreeFee() external view returns (uint256);

    function userFreeFeeLimit() external view returns (uint256);

    function feeRecoverInterval() external view returns (uint256);

    function freeFeeRecoverInterval() external view returns (uint256);

    function feePoolLiquidateInterval() external view returns (uint256);

    function minIndexVotingPower() external view returns (uint256);

    function getFactorByReason(uint8 reason) external view returns (uint8);

    function setCommissionRateInterval() external view returns (uint256);

    function minerRewardFactor() external view returns (uint8);
}
