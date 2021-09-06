// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

// This is just a contract used during testing.
contract Config_test is IConfig {
    address private s;
    address private c;
    address private u;
    address private v;
    address private f;
    address private ff;
    address private fp;
    address private r;

    function setStakeManager(address _s) external {
        s = _s;
    }

    function setSystemCaller(address _c) external {
        c = _c;
    }

    function setUnstakePool(address _u) external {
        u = _u;
    }

    function setValidatorRewardPool(address _v) external {
        v = _v;
    }

    function setFee(address _f) external {
        f = _f;
    }

    function setFreeFee(address _ff) external {
        ff = _ff;
    }

    function setFeePool(address _fp) external {
        fp = _fp;
    }

    function setRouter(address _r) external {
        r = _r;
    }

    function stakeManager() external view override returns (address) {
        return s;
    }

    function systemCaller() external view override returns (address) {
        return c;
    }

    function unstakePool() external view override returns (address) {
        return u;
    }

    function validatorRewardPool() external view override returns (address) {
        return v;
    }

    function fee() external view override returns (address) {
        return f;
    }

    function freeFee() external view override returns (address) {
        return ff;
    }

    function feePool() external view override returns (address) {
        return fp;
    }

    function router() external view override returns (address) {
        return r;
    }

    function unstakeDelay() external view override returns (uint256) {
        return 1 seconds;
    }

    function withdrawDelay() external view override returns (uint256) {
        return 1 seconds;
    }

    function dailyFee() external view override returns (uint256) {
        return 12e16;
    }

    function dailyFreeFee() external view override returns (uint256) {
        return 12e15;
    }

    function userFreeFeeLimit() external view override returns (uint256) {
        return 12e14;
    }

    function feeRecoverInterval() external view override returns (uint256) {
        return 10 seconds;
    }

    function freeFeeRecoverInterval() external view override returns (uint256) {
        return 10 seconds;
    }

    function feePoolLiquidateInterval() external view override returns (uint256) {
        return 10 seconds;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        return 10000;
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else if (reason == 1) {
            return 100;
        } else {
            revert("Config: invalid reason");
        }
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return 5 seconds;
    }

    function minerRewardFactor() external view override returns (uint8) {
        return 90;
    }

    // a simple function to get blockchain timestamp for test
    function blockTimestamp() external view returns (uint256) {
        return block.timestamp;
    }
}
