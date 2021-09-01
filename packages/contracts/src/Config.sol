// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

// TODO: DAO logic
contract Config is IConfig {
    // get stake manager address
    function stakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001001;
    }

    // get system caller address
    function systemCaller() external view override returns (address) {
        return 0x0000000000000000000000000000000000001002;
    }

    // get unstake manager address
    function unstakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001003;
    }

    // get validator reward manager address
    function validatorRewardManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001004;
    }

    function feeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001005;
    }

    // get unstake delay
    function unstakeDelay() external view override returns (uint256) {
        return 1 minutes;
    }

    function withdrawDelay() external view override returns (uint256) {
        return 3 days;
    }

    function dailyFee() external view override returns (uint256) {
        return 1728e17;
    }

    function feeRecoverInterval() external view override returns (uint256) {
        return 1 days;
    }

    /**
     * @dev Get min index voting power.
     *      Only when the validator's voting power is greater than this value, will the index be created for him.
     *      The blockchain only sorts the validators who have created the index.
     */
    function minIndexVotingPower() external view override returns (uint256) {
        // 2 GXC
        return 2e18;
    }

    /**
     * @dev Get slash factor by reason.
     * @param reason    Reason id.
     *                  1 - Repeated sign.
     */
    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else {
            revert("Config: invalid reason");
        }
    }

    // set commission rate interval
    function setCommissionRateInterval() external view override returns (uint256) {
        return 1 minutes;
    }
}
