// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "../interfaces/IConfig.sol";

// This is just a contract used during testing.
// The officially released contract is in `Config_prod.sol`.
contract Config is IConfig {
    address private s;

    function setStakeManager(address _s) external {
        s = _s;
    }

    function stakeManager() external view override returns (address) {
        return s;
    }

    function unstakeDelay() external view override returns (uint256) {
        return 1 seconds;
    }

    function minStakeAmount() external view override returns (uint256) {
        return 10;
    }

    function minUnstakeAmount() external view override returns (uint256) {
        return 5;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        return 100;
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
