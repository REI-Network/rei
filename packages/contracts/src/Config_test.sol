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

    function setStakeManager(address _s) external {
        s = _s;
    }

    function setSystemCaller(address _c) external {
        c = _c;
    }

    function setUnstakeManager(address _u) external {
        u = _u;
    }

    function setValidatorRewardManager(address _v) external {
        v = _v;
    }

    function setFeeManager(address _f) external {
        f = _f;
    }

    function stakeManager() external view override returns (address) {
        return s;
    }

    function systemCaller() external view override returns (address) {
        return c;
    }

    function unstakeManager() external view override returns (address) {
        return u;
    }

    function validatorRewardManager() external view override returns (address) {
        return v;
    }

    function feeManager() external view override returns (address) {
        return f;
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

    function feeRecoverInterval() external view override returns (uint256) {
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
}
