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

    function feePool() external view returns (address);

    function prison() external view returns (address);

    function feeToken() external view returns (address);

    function unstakeDelay() external view returns (uint256);

    function withdrawDelay() external view returns (uint256);

    function minIndexVotingPower() external view returns (uint256);

    function getFactorByReason(uint8 reason) external view returns (uint8);

    function setCommissionRateInterval() external view returns (uint256);

    function feePoolInterval() external view returns (uint256);

    function recordsAmountPeriod() external view returns (uint256);

    function forfeit() external view returns (uint256);

    function jailThreshold() external view returns (uint256);

    function maxValidatorsCount() external view returns (uint256);

    function minValidatorsCount() external view returns (uint256);

    function minTotalLockedAmount() external view returns (uint256);

    function minerReward() external view returns (uint256);

    function dailyFee() external view returns (uint256);

    function minerRewardFactor() external view returns (uint256);

    function setUnstakeDelay(uint256 _unstakeDelay) external;

    function setWithdrawDelay(uint256 _withdrawDelay) external;

    function setSetCommissionRateInterval(uint256 _setCommissionRateInterval) external;

    function setFeePoolInterval(uint256 _feePoolInterval) external;

    function setForfeit(uint256 _forfeit) external;

    function setJailThreshold(uint256 _jailThreshold) external;

    function setMaxValidatorsCount(uint256 _maxValidatorsCount) external;

    function setMinValidatorsCount(uint256 _minValidatorsCount) external;

    function setMinTotalLockedAmount(uint256 _minTotalLockedAmount) external;

    function setMinerReward(uint256 _minerReward) external;

    function setDailyFee(uint256 _dailyFee) external;

    function setMinerRewardFactor(uint256 _minerRewardFactor) external;
}
