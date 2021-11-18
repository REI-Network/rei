// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFreeFee.sol";
import "./Only.sol";

contract FreeFee is ReentrancyGuard, Only, IFreeFee {
    using SafeMath for uint256;

    // free fee usage info of user
    mapping(address => UsageInfo) public override userUsage;

    // total usage of free fee in the past 24 hours
    uint256 public override totalUsage;
    // global timestamp, update every 24 hours
    uint256 public override globalTimestamp;

    constructor(IConfig config) public Only(config) {}

    /**
     * Estimate total daily free fee left.
     * @param timestamp        Current timestamp
     */
    function estimateTotalLeft(uint256 timestamp) public view override returns (uint256 totalLeft) {
        uint256 _totalUsage = totalUsage;
        if (globalTimestamp.add(config.freeFeeRecoverInterval()) < timestamp) {
            _totalUsage = 0;
        }
        uint256 dailyFreeFee = config.dailyFreeFee();
        totalLeft = dailyFreeFee > _totalUsage ? dailyFreeFee - _totalUsage : 0;
    }

    /**
     * Estimate user daily free fee usage.
     * @param ui                User usage information
     * @param timestamp         Current timestamp
     */
    function estimateUsage(UsageInfo memory ui, uint256 timestamp) public view override returns (uint256) {
        uint256 _globalTimestamp = globalTimestamp;
        if (_globalTimestamp.add(config.freeFeeRecoverInterval()) < timestamp) {
            _globalTimestamp = timestamp;
        }
        return ui.timestamp >= _globalTimestamp ? ui.usage : 0;
    }

    /**
     * Estimate user daily free fee left.
     * @param user              User address
     * @param timestamp         Current timestamp
     */
    function estimateFreeFee(address user, uint256 timestamp) external view override returns (uint256) {
        uint256 totalLeft = estimateTotalLeft(timestamp);
        if (totalLeft == 0) {
            return 0;
        }

        uint256 _userUsage = estimateUsage(userUsage[user], timestamp);
        uint256 userFreeFeeLimit = config.userFreeFeeLimit();
        uint256 userLeft = userFreeFeeLimit > _userUsage ? userFreeFeeLimit - _userUsage : 0;
        return userLeft > totalLeft ? totalLeft : userLeft;
    }

    /**
     * Consume user usage, it only can be called by router.
     * @param user              Transaction sender
     * @param usage             Usage amount
     */
    function consume(address user, uint256 usage) external override nonReentrant onlyRouter {
        require(usage > 0, "FreeFee: invalid usage");
        UsageInfo storage ui = userUsage[user];
        if (ui.timestamp < globalTimestamp) {
            ui.usage = usage;
        } else {
            ui.usage = ui.usage.add(usage);
        }
        ui.timestamp = block.timestamp;
        totalUsage = totalUsage.add(usage);
    }

    /**
     * After block callback, it only can be called by router, it will update `globalTimestamp` if the time interval exceeds `freeFeeRecoverInterval`.
     */
    function onAfterBlock() external override nonReentrant onlyRouter {
        if (globalTimestamp.add(config.freeFeeRecoverInterval()) < block.timestamp) {
            totalUsage = 0;
            globalTimestamp = block.timestamp;
        }
    }
}
