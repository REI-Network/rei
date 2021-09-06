// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IOnly.sol";

/**
 * @dev see {FreeFee}
 */
interface IFreeFee is IOnly {
    struct UsageInfo {
        uint256 usage;
        uint256 timestamp;
    }

    function userUsage(address) external view returns (uint256, uint256);

    function totalUsage() external view returns (uint256);

    function globalTimestamp() external view returns (uint256);

    function estimateTotalLeft(uint256 timestamp) external view returns (uint256);

    function estimateUsage(UsageInfo calldata ui) external view returns (uint256);

    function estimateFreeFee(address user, uint256 timestamp) external view returns (uint256);

    function consume(address user, uint256 usage) external;

    function onAfterBlock() external;
}
