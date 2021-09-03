// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Only.sol";

struct UsageInfo {
    uint256 usage;
    uint256 timestamp;
}

contract FreeFee is Only {
    using SafeMath for uint256;

    mapping(address => UsageInfo) public userUsage;

    uint256 public totalUsage;
    uint256 public globalTimestamp;

    constructor(IConfig config) public Only(config) {}

    function estimateTotalLeft(uint256 timestamp) public view returns (uint256 totalLeft) {
        uint256 _totalUsage = totalUsage;
        if (globalTimestamp.add(config.freeFeeRecoverInterval()) < timestamp) {
            _totalUsage = 0;
        }
        uint256 dailyFreeFee = config.dailyFreeFee();
        totalLeft = dailyFreeFee > _totalUsage ? dailyFreeFee - _totalUsage : 0;
    }

    function estimateFee(address user, uint256 timestamp) external view returns (uint256) {
        uint256 totalLeft = estimateTotalLeft(timestamp);
        if (totalLeft == 0) {
            return 0;
        }

        uint256 _userUsage = 0;
        UsageInfo memory ui = userUsage[user];
        if (ui.timestamp >= globalTimestamp) {
            _userUsage = ui.usage;
        }
        uint256 userFreeFeeLimit = config.userFreeFeeLimit();
        uint256 userLeft = userFreeFeeLimit > _userUsage ? userFreeFeeLimit - _userUsage : 0;
        return userLeft > totalLeft ? totalLeft : userLeft;
    }

    function consume(address user, uint256 usage) external onlySystemCaller {
        UsageInfo storage ui = userUsage[user];
        if (ui.timestamp < globalTimestamp) {
            ui.usage = usage;
        } else {
            ui.usage = ui.usage.add(usage);
        }
        ui.timestamp = block.timestamp;
        totalUsage = totalUsage.add(usage);
    }

    function afterBlock() external onlySystemCaller {
        if (globalTimestamp.add(config.freeFeeRecoverInterval()) < block.timestamp) {
            totalUsage = 0;
            globalTimestamp = block.timestamp;
        }
    }
}
