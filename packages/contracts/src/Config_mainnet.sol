// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

/**
 * Config contract for mainnet.
 * In rei-network, system contracts can be updated through hard forks,
 * and DAO logic will be added in the futhure.
 */
contract Config is IConfig {
    function stakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001001;
    }

    function systemCaller() external view override returns (address) {
        return 0x0000000000000000000000000000000000001002;
    }

    function unstakePool() external view override returns (address) {
        return 0x0000000000000000000000000000000000001003;
    }

    function validatorRewardPool() external view override returns (address) {
        return 0x0000000000000000000000000000000000001004;
    }

    function fee() external view override returns (address) {
        return 0x0000000000000000000000000000000000001005;
    }

    function freeFee() external view override returns (address) {
        return 0x0000000000000000000000000000000000001006;
    }

    function feePool() external view override returns (address) {
        return 0x0000000000000000000000000000000000001007;
    }

    function router() external view override returns (address) {
        return 0x0000000000000000000000000000000000001008;
    }

    function contractFee() external view override returns (address) {
        return 0x000000000000000000000000000000000000100b;
    }

    function unstakeDelay() external view override returns (uint256) {
        return 7 days;
    }

    function withdrawDelay() external view override returns (uint256) {
        return 3 days;
    }

    function dailyFee() external view override returns (uint256) {
        // 283 REI
        return 283e18;
    }

    function dailyFreeFee() external view override returns (uint256) {
        // 5 REI
        return 5e18;
    }

    function userFreeFeeLimit() external view override returns (uint256) {
        // 0.025 REI
        return 25e15;
    }

    function feeRecoverInterval() external view override returns (uint256) {
        return 1 days;
    }

    function freeFeeRecoverInterval() external view override returns (uint256) {
        return 1 days;
    }

    function feePoolLiquidateInterval() external view override returns (uint256) {
        return 1 days;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        // 1,000,000 REI
        return 1e24;
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return 1 days;
    }

    function minerRewardFactor() external view override returns (uint8) {
        return 90;
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else {
            revert("Config: invalid reason");
        }
    }
}
