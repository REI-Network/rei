// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

// TODO: DAO logic
contract Config_prod is IConfig {
    function stakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001001;
    }

    function unstakeDelay() external view override returns (uint256) {
        return 3 weeks;
    }

    function minStakeAmount() external view override returns (uint256) {
        // 10 GXC
        return 10e18;
    }

    function minUnstakeAmount() external view override returns (uint256) {
        // 5 GXC
        return 5e18;
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else {
            revert("Config: invalid reason");
        }
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return 5;
    }
}
